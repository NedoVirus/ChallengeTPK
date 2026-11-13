
const API_URL =
  'https://script.google.com/macros/s/AKfycby131tLHIX7DyqQFXkBxH0tkdd3pX6Qy0EfKCTsqb4RSVRmIjTvQWv2E7PzbPu8WpDiXQ/exec';

let callbackCounter = 0;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * GET через JSONP.
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
        new Error('Не удалось подключиться к Google Apps Script')
      );
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error('Превышено время ожидания ответа Google Apps Script')
      );
    }, 20000);

    script.async = true;
    script.src = url.toString();

    document.head.appendChild(script);
  });
}


/**
 * POST через скрытый iframe.
 *
 * Google Apps Script возвращает HTML-страницу,
 * которая передаёт настоящий результат через postMessage.
 */
function sendGasForm(payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const requestId =
      `stepChallengeFrame${Date.now()}${++callbackCounter}`;

    const iframe = document.createElement('iframe');
    iframe.name = requestId;
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = API_URL;
    form.target = requestId;
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';

    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }

      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = String(value);

      form.appendChild(input);
    });

    let finished = false;
    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      form.remove();
      iframe.remove();
    };

    const finish = (callback, value) => {
      if (finished) {
        return;
      }

      finished = true;
      cleanup();
      callback(value);
    };

    const handleMessage = (event) => {
      // Принимаем сообщение только от созданного нами iframe.
      if (event.source !== iframe.contentWindow) {
        return;
      }

      const message = event.data;

      if (
        !message ||
        message.type !== 'STEP_CHALLENGE_GAS_RESPONSE'
      ) {
        return;
      }

      if (!message.data || typeof message.data !== 'object') {
        finish(
          reject,
          new Error('Google Apps Script вернул некорректный ответ.')
        );
        return;
      }

      finish(resolve, message.data);
    };

    window.addEventListener('message', handleMessage);

    timeout = setTimeout(() => {
      finish(
        reject,
        new Error(
          'Google Apps Script не ответил на POST-запрос. Проверь веб-развёртывание.'
        )
      );
    }, timeoutMs);

    document.body.appendChild(iframe);
    document.body.appendChild(form);

    try {
      form.submit();
    } catch (error) {
      finish(
        reject,
        new Error(
          'Не удалось отправить POST-запрос: ' + error.message
        )
      );
    }
  });
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

  const result = await sendGasForm(payload, 30000);

  if (!result?.ok) {
    throw new Error(
      result?.error || 'Google Apps Script отклонил регистрацию.'
    );
  }

  const stats = await getGasJsonp('stats');

  return {
    ...result,
    registeredCount: Number(stats?.registeredCount) || 0,
  };
}


/**
 * Отправка ежедневного результата со скриншотом Google Fit.
 */
export async function submitStepsResult(payload) {
  const userId = String(payload.vk_user_id || '');

  if (!/^\d+$/.test(userId)) {
    throw new Error('Не удалось определить VK ID пользователя');
  }

  if (payload.action !== 'submit_result') {
    throw new Error('Неизвестная операция отправки результата');
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

  const result = await sendGasForm(postPayload, 90000);

  if (!result?.ok) {
    const messages = {
      server_not_configured:
        'Не настроены параметры VK в Apps Script.',
      vk_signature_missing:
        'Не найдена подпись VK. Перезапусти приложение через VK.',
      invalid_vk_signature:
        'VK не подтвердил подлинность запуска.',
      participant_not_registered:
        'Сначала зарегистрируйся в челлендже.',
      invalid_challenge_date:
        'Неверная дата результата.',
      future_challenge_date:
        'Нельзя отправить результат за будущий день.',
      challenge_not_active:
        'Челлендж не активен на выбранную дату.',
      invalid_steps:
        'Некорректное количество шагов.',
      invalid_image_type:
        'Поддерживаются только JPG, PNG и WEBP.',
      invalid_image_size:
        'Размер изображения превышает допустимый.',
      invalid_image_data:
        'Не удалось прочитать изображение.',
    };

    throw new Error(
      messages[result?.error] ||
      result?.error ||
      'Не удалось отправить результат.'
    );
  }

  // Если результат уже отправлялся,
  // получаем состояние существующей заявки.
  if (result.status === 'already_submitted') {
    const current = await getGasJsonp(
      'submission_status',
      {
        ...signedLaunchParams,
        challenge_date: payload.challenge_date,
      }
    );

    return {
      ok: true,
      status: 'already_submitted',
      submission: current?.submission || null,
      message: 'За этот день результат уже отправлен.',
    };
  }

  return {
    ok: true,
    status: 'На проверке',
    submission: {
      steps: Number(payload.steps) || 0,
      status: 'На проверке',
      submittedAt: new Date().toISOString(),
      comment: '',
    },
    message: 'Скриншот отправлен и ожидает проверки модератором.',
  };
}
