const API_URL =
  'https://script.google.com/macros/s/AKfycby131tLHIX7DyqQFXkBxH0tkdd3pX6Qy0EfKCTsqb4RSVRmIjTvQWv2E7PzbPu8WpDiXQ/exec';

let callbackCounter = 0;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * GET-запрос к Google Apps Script через JSONP.
 */
export function getGasJsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName =
      `__stepChallengeCallback${Date.now()}${++callbackCounter}`;

    const url = new URL(API_URL);

    url.searchParams.set('action', action);
    url.searchParams.set('callback', callbackName);
    url.searchParams.set('_ts', String(Date.now()));

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    const script = document.createElement('script');
    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    };

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();

      reject(
        new Error(
          'Не удалось подключиться к Google Apps Script'
        )
      );
    };

    timeout = setTimeout(() => {
      cleanup();

      reject(
        new Error(
          'Превышено время ожидания ответа Google Apps Script'
        )
      );
    }, 20000);

    script.async = true;
    script.src = url.toString();

    document.head.appendChild(script);
  });
}


/**
 * Отправка x-www-form-urlencoded POST.
 *
 * Ответ Google Apps Script непрозрачный из-за CORS,
 * поэтому результат проверяется отдельным JSONP-запросом.
 */

async function sendGasForm(payload, timeoutMs = 30000) {
  const body = new URLSearchParams();

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  });

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      redirect: 'follow',
      credentials: 'omit',

      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded;charset=UTF-8',
      },

      body: body.toString(),
      signal: controller.signal,
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(
        'Время отправки запроса истекло. Проверь журнал выполнений Apps Script.'
      );
    }

    throw new Error(
      'Не удалось отправить запрос в Google Apps Script. Проверь интернет-соединение.'
    );

  } finally {
    clearTimeout(timeout);
  }
}


/**
 * Регистрация участника.
 */

export async function postGasForm(payload) {
  const userId = String(payload.vk_user_id || '');

  if (!/^\d+$/.test(userId)) {
    throw new Error('Некорректный VK ID пользователя');
  }

  if (payload.action !== 'register') {
    throw new Error('Неизвестная операция регистрации');
  }

  await sendGasForm(payload, 30000);

  let lastError = null;

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const participant = await getGasJsonp(
        'participant',
        {
          vk_user_id: userId,
        }
      );

      if (!participant?.ok) {
        throw new Error(
          participant?.error ||
          'Ошибка проверки участника'
        );
      }

      if (participant.registered) {
        const stats = await getGasJsonp('stats');

        return {
          ok: true,
          status: 'registered',
          message:
            'Регистрация успешно подтверждена Google Таблицей!',
          registeredCount:
            Number(stats?.registeredCount) || 0,
          participant: participant.participant,
        };
      }

    } catch (error) {
      lastError = error;
    }

    await delay(500 + attempt * 500);
  }

  if (lastError) {
    throw new Error(
      'Запрос отправлен, но проверить запись в Google Таблице не удалось: ' +
      lastError.message
    );
  }

  throw new Error(
    'Google Apps Script получил запрос, но участник не появился в Google Таблице. Проверь журнал выполнений Apps Script.'
  );
}


/**
 * Отправка ежедневного результата со скриншотом Google Fit.
 */

export async function submitStepsResult(payload) {
  const userId = String(payload.vk_user_id || '');

  if (!/^\d+$/.test(userId)) {
    throw new Error(
      'Не удалось определить VK ID пользователя'
    );
  }

  if (payload.action !== 'submit_result') {
    throw new Error(
      'Неизвестная операция отправки результата'
    );
  }

  if (!payload.image_base64) {
    throw new Error('Не выбран скриншот');
  }

  if (String(payload.image_base64).length > 5800000) {
    throw new Error(
      'Скриншот слишком большой. Максимальный размер — 4 МБ.'
    );
  }

  const {
    signed_launch_params: signedLaunchParams,
    ...postPayload
  } = payload;

  const requestStartedAt = Date.now();

  await sendGasForm(postPayload, 90000);

  let lastError = null;

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const data = await getGasJsonp(
        'submission_status',
        {
          ...signedLaunchParams,
          challenge_date: payload.challenge_date,
        }
      );

      if (!data?.ok) {
        const messages = {
          server_not_configured:
            'Не настроены параметры VK в Apps Script.',

          vk_signature_missing:
            'Не найдена подпись VK. Перезапусти приложение через VK.',

          invalid_vk_signature:
            'VK не подтвердил подлинность запуска. Перезапусти приложение.',

          invalid_vk_app_id:
            'ID приложения VK не совпадает с настройками сервера.',

          invalid_vk_user_id:
            'Не удалось определить пользователя VK.',
        };

        throw new Error(
          messages[data?.error] ||
          data?.error ||
          'Не удалось проверить результат.'
        );
      }

      if (data.submitted && data.submission) {
        const submittedAt = Date.parse(
          data.submission.submittedAt || ''
        );

        const isOldRejectedSubmission =
          data.submission.status === 'Отклонено' &&
          Number.isFinite(submittedAt) &&
          submittedAt < requestStartedAt;

        if (isOldRejectedSubmission) {
          await delay(700 + attempt * 500);
          continue;
        }

        return {
          ok: true,

          status: data.submission.status,

          submission: data.submission,

          message:
            data.submission.status === 'На проверке'
              ? 'Скриншот отправлен и ожидает проверки модератором.'
              : data.submission.status === 'Одобрено'
                ? 'Результат за этот день уже одобрен.'
                : 'Последняя отправка была отклонена. Можно отправить новый скриншот.',
        };
      }

    } catch (error) {
      lastError = error;
    }

    await delay(700 + attempt * 500);
  }

  if (lastError) {
    throw new Error(
      'Запрос отправлен, но статус не удалось проверить: ' +
      lastError.message +
      '. Не отправляй тот же скриншот повторно сразу — сначала проверь лист «Результаты».'
    );
  }

  throw new Error(
    'Сервер не подтвердил сохранение результата. Проверь журнал выполнений Apps Script и лист «Результаты».'
  );
}