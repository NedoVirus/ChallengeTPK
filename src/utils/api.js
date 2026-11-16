const API_URL =
  'https://script.google.com/macros/s/AKfycby131tLHIX7DyqQFXkBxH0tkdd3pX6Qy0EfKCTsqb4RSVRmIjTvQWv2E7PzbPu8WpDiXQ/exec';

let callbackCounter = 0;

// Не допускаем параллельные POST-регистрации одного VK ID.
const registrationRequests = new Map();


/* =====================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
===================================== */

function createRequestId() {
  const bytes = new Uint8Array(16);

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);

    return Array.from(bytes)
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  }

  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  );
}


/* =====================================
   GET: JSONP
   Тайм-аут по умолчанию — 15 секунд.
===================================== */

export function getGasJsonp(
  action,
  params = {},
  timeoutMs = 15000
) {
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

    window[callbackName] = data => {
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
          'Google Apps Script не ответил за 15 секунд. Проверь подключение и журнал выполнений.'
        )
      );
    }, timeoutMs);

    script.async = true;
    script.src = url.toString();

    document.head.appendChild(script);
  });
}


/* =====================================
   POST: HTML-ФОРМА + IFRAME
===================================== */

function sendGasForm(payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const requestId = createRequestId();

    const iframeName =
      `stepChallengeFrame${Date.now()}${++callbackCounter}`;

    const iframe = document.createElement('iframe');

    iframe.name = iframeName;
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');

    const form = document.createElement('form');

    form.method = 'POST';
    form.action = API_URL;
    form.target = iframeName;
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

    const requestInput = document.createElement('input');

    requestInput.type = 'hidden';
    requestInput.name = '_request_id';
    requestInput.value = requestId;

    form.appendChild(requestInput);

    let finished = false;
    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);

      window.removeEventListener(
        'message',
        handleMessage
      );

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

    const handleMessage = event => {
      const message = event.data;

      if (
        !message ||
        message.type !== 'STEP_CHALLENGE_GAS_RESPONSE'
      ) {
        return;
      }

      if (message.requestId !== requestId) {
        return;
      }

      if (!message.data || typeof message.data !== 'object') {
        finish(
          reject,
          new Error(
            'Google Apps Script вернул некорректный ответ.'
          )
        );

        return;
      }

      finish(resolve, message.data);
    };

    window.addEventListener(
      'message',
      handleMessage
    );

    timeout = setTimeout(() => {
      finish(
        reject,
        new Error(
          'Google Apps Script не ответил на POST-запрос. Проверь версию веб-развёртывания.'
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
          'Не удалось отправить POST-запрос: ' +
          error.message
        )
      );
    }
  });
}


/* =====================================
   ОТПРАВКА И ПРОВЕРКА РЕГИСТРАЦИИ
===================================== */

/**
 * Подтверждение регистрации через фактическую запись в Google Таблице.
 * Ответ POST-iframe больше не является обязательным условием успеха.
 */
async function registerParticipantWithVerification(payload, userId) {
  const body = new URLSearchParams();

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  });

  const controller = new AbortController();
  const postTimeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  let postError = null;

  try {
    // Запрос отправляется как обычная HTML-форма.
    // Из-за CORS ответ непрозрачный: читать его не нужно.
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      redirect: 'follow',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: body.toString(),
      signal: controller.signal,
    });

  } catch (error) {
    // Даже при сетевой ошибке POST мог успеть дойти до Apps Script.
    // Поэтому сначала всё равно проверяем таблицу через GET participant.
    postError = error;
    console.warn(
      'POST регистрации не вернул сетевое подтверждение. Проверяем запись в таблице:',
      error
    );

  } finally {
    clearTimeout(postTimeout);
  }

  let lastCheckError = null;

  // Apps Script может записать строку чуть позже завершения POST.
  // Несколько проверок позволяют дождаться появления участника.
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const participantResult = await getGasJsonp(
        'participant',
        { vk_user_id: userId },
        8000
      );

      if (!participantResult?.ok) {
        throw new Error(
          participantResult?.error ||
          'Не удалось проверить запись участника.'
        );
      }

      // Последний GET прошёл успешно: прежняя временная ошибка
      // больше не должна влиять на итоговый результат.
      lastCheckError = null;

      if (participantResult.registered) {
        const participant = participantResult.participant || null;
        const disqualified = participant?.status === 'disqualified';

        // Статистика вспомогательная. Её сбой не отменяет регистрацию.
        let registeredCount;

        try {
          const stats = await getGasJsonp('stats', {}, 8000);

          if (
            stats?.ok &&
            Number.isFinite(Number(stats.registeredCount))
          ) {
            registeredCount = Number(stats.registeredCount);
          }

        } catch (statsError) {
          console.warn(
            'Регистрация подтверждена, но статистику участников загрузить не удалось:',
            statsError
          );
        }

        return {
          ok: true,
          status: disqualified
            ? 'disqualified'
            : 'registered',
          message: disqualified
            ? 'Вы дисквалифицированы и не можете отправлять новые результаты.'
            : 'Регистрация успешно подтверждена Google Таблицей!',
          ...(registeredCount !== undefined
            ? { registeredCount }
            : {}),
          participant,
        };
      }

    } catch (error) {
      lastCheckError = error;
    }

    if (attempt < 8) {
      await new Promise(resolve => {
        setTimeout(resolve, 500 + attempt * 500);
      });
    }
  }

  if (lastCheckError) {
    throw new Error(
      'Запрос регистрации был отправлен, но не удалось проверить запись в Google Таблице: ' +
      lastCheckError.message
    );
  }

  if (postError) {
    const detail = postError.name === 'AbortError'
      ? 'Время отправки запроса истекло.'
      : 'Не удалось подтвердить отправку запроса.';

    throw new Error(
      detail +
      ' Участник не появился в Google Таблице. Проверь интернет-соединение и журнал выполнений Apps Script.'
    );
  }

  throw new Error(
    'Google Apps Script получил запрос, но участник не появился в Google Таблице. Проверь журнал выполнений Apps Script.'
  );
}


/* =====================================
   РЕГИСТРАЦИЯ
===================================== */

export function postGasForm(payload) {
  const userId = String(
    payload?.vk_user_id || ''
  );

  if (!/^\d+$/.test(userId)) {
    return Promise.reject(
      new Error('Некорректный VK ID пользователя')
    );
  }

  if (payload?.action !== 'register') {
    return Promise.reject(
      new Error('Неизвестная операция регистрации')
    );
  }

  // Нормализуем признак сотрудника перед отправкой на сервер.
  // Старые версии Home.jsx без is_employee по умолчанию считаются студентами.
  const isEmployee =
    payload?.is_employee === true ||
    String(payload?.is_employee || '').trim().toLowerCase() === 'true';

  const registrationPayload = {
    ...payload,
    is_employee: isEmployee ? 'true' : 'false',
    group: isEmployee
      ? 'Сотрудник'
      : String(payload?.group || '').trim(),
  };

  // Повторный вызов для того же VK ID использует уже выполняющийся запрос.
  const existingRequest = registrationRequests.get(userId);

  if (existingRequest) {
    return existingRequest;
  }

  const request = registerParticipantWithVerification(
    registrationPayload,
    userId
  ).finally(() => {
    registrationRequests.delete(userId);
  });

  registrationRequests.set(userId, request);

  return request;
}


/* =====================================
   ОТПРАВКА РЕЗУЛЬТАТА
===================================== */

export async function submitStepsResult(payload) {
  const userId = String(
    payload.vk_user_id || ''
  );

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

  if (
    String(payload.image_base64).length > 5800000
  ) {
    throw new Error(
      'Скриншот слишком большой. Максимальный размер — 4 МБ.'
    );
  }

  const {
    signed_launch_params: signedLaunchParams,
    ...postPayload
  } = payload;

  const result = await sendGasForm(
    postPayload,
    90000
  );

  if (!result?.ok) {
    const messages = {
      challenge_inactive:
        'Челлендж сейчас неактивен. Активностей нет.',

      image_base64_decode_failed:
        'Ошибка декодирования изображения. Попробуй сохранить скриншот заново.',

      image_signature_mismatch:
        'Формат изображения не совпадает с содержимым файла. Попробуй сделать новый скриншот.',

      invalid_image_data:
        'Не удалось прочитать изображение.',

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

      database_not_configured:
        'Не настроена Google Таблица.',
    };

    throw new Error(
      messages[result?.error] ||
      result?.error ||
      'Не удалось отправить результат.'
    );
  }

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
    ...result,
    message:
      result.message ||
      'Скриншот отправлен на проверку модератору.',
  };
}


/* =====================================
   ОЧЕРЕДЬ МОДЕРАЦИИ
===================================== */

export async function getModerationQueue(
  signedLaunchParams
) {
  const result = await getGasJsonp(
    'moderation_queue',
    signedLaunchParams
  );

  if (!result?.ok) {
    const messages = {
      challenge_inactive:
        'Челлендж сейчас неактивен. Модерация недоступна.',

      moderator_access_denied:
        'У этого аккаунта нет доступа к модерации.',

      invalid_vk_signature:
        'Не удалось подтвердить аккаунт VK.',

      server_not_configured:
        'Не настроены параметры VK в Apps Script.',
    };

    throw new Error(
      messages[result?.error] ||
      result?.error ||
      'Не удалось загрузить очередь модерации.'
    );
  }

  return result.submissions || [];
}


/* =====================================
   ЗАГРУЗКА СКРИНШОТА МОДЕРАТОРОМ
===================================== */

export async function getModerationImage(
  signedLaunchParams,
  submissionId
) {
  const result = await getGasJsonp(
    'moderation_image',
    {
      ...signedLaunchParams,
      submission_id: submissionId,
    },
    90000
  );

  if (!result?.ok) {
    throw new Error(
      result?.error ||
      'Не удалось загрузить скриншот.'
    );
  }

  return {
    mimeType: result.mimeType,
    imageBase64: result.imageBase64,
  };
}


/* =====================================
   ОДОБРЕНИЕ / ОТКЛОНЕНИЕ
===================================== */

export async function moderateSubmission(payload) {
  if (!payload?.submission_id) {
    throw new Error('Не указан ID заявки.');
  }

  if (
    !['Одобрено', 'Отклонено'].includes(
      payload.decision
    )
  ) {
    throw new Error(
      'Не выбрано решение модератора.'
    );
  }

  const result = await sendGasForm(
    {
      action: 'moderate_result',
      ...payload,
    },
    30000
  );

  if (!result?.ok) {
    const messages = {
      challenge_inactive:
        'Челлендж сейчас неактивен. Модерация недоступна.',

      moderator_access_denied:
        'У этого аккаунта нет доступа к модерации.',

      submission_not_found:
        'Заявка не найдена.',

      submission_already_reviewed:
        'Эта заявка уже была проверена.',

      invalid_moderation_decision:
        'Некорректное решение модератора.',

      invalid_vk_signature:
        'VK не подтвердил подлинность аккаунта.',
    };

    throw new Error(
      messages[result?.error] ||
      result?.error ||
      'Не удалось сохранить решение модератора.'
    );
  }

  return result;
}


/* =====================================
   СТАТУС ЧЕЛЛЕНДЖА
===================================== */

export async function getChallengeStatus(timeoutMs = 15000) {
  try {
    const result = await getGasJsonp(
      'challenge_status',
      {},
      timeoutMs
    );

    if (!result?.ok) {
      // Безопасный фолбэк: если сервер не ответил — считаем неактивным.
      return { active: false, error: result?.error };
    }

    return { active: Boolean(result.active) };
  } catch (error) {
    console.warn('Не удалось получить статус челленджа:', error);
    return { active: false, error: error.message };
  }
}


/* =====================================
   ТЕСТОВОЕ PUSH-УВЕДОМЛЕНИЕ
===================================== */

export async function sendTestNotification(
  signedLaunchParams
) {
  if (
    !signedLaunchParams?.vk_user_id ||
    !signedLaunchParams?.vk_app_id ||
    !signedLaunchParams?.sign
  ) {
    throw new Error(
      'Не удалось получить подписанные параметры запуска VK. Перезапусти приложение через VK.'
    );
  }

  const result = await sendGasForm(
    {
      action: 'test_push',
      ...signedLaunchParams,
    },
    30000
  );

  if (!result?.ok) {
    const messages = {
      moderator_access_denied:
        'Тестовое уведомление может отправить только модератор.',

      invalid_vk_signature:
        'VK не подтвердил подлинность запуска. Перезапусти приложение через VK.',

      server_not_configured:
        'Не настроены параметры проверки подписи VK в Apps Script.',

      vk_service_key_not_configured:
        'В настройках Apps Script не найден сервисный ключ VK. Проверь Script Properties: VK_SERVICE_KEY.',

      vk_http_error:
        'VK вернул HTTP-ошибку при отправке уведомления.',
    };

    if (result?.error === 'vk_api_error') {
      const code = result.vkErrorCode
        ? ` Код ошибки: ${result.vkErrorCode}.`
        : '';
      const details = result.vkMessage
        ? ` ${result.vkMessage}`
        : '';

      throw new Error(
        `VK API отклонил отправку уведомления.${code}${details}`
      );
    }

    if (result?.error === 'vk_http_error' && result?.vkMessage) {
      throw new Error(
        `${messages.vk_http_error} ${result.vkMessage}`
      );
    }

    throw new Error(
      messages[result?.error] ||
      result?.vkMessage ||
      result?.error ||
      'Не удалось отправить тестовое push-уведомление.'
    );
  }

  return result;
}