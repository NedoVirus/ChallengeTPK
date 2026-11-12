
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
        new Error('Не удалось подключиться к Google Apps Script')
      );
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error('Превышено время ожидания ответа Google Apps Script')
      );
    }, 15000);

    script.async = true;
    script.src = url.toString();

    document.head.appendChild(script);
  });
}

/**
 * POST-запрос без чтения ответа из-за CORS.
 *
 * После отправки проверяем фактическую запись
 * пользователя в Google Таблице через JSONP.
 */
export async function postGasForm(payload) {
  const userId = String(payload.vk_user_id || '');

  if (!/^\d+$/.test(userId)) {
    throw new Error('Некорректный VK ID пользователя');
  }

  if (payload.action !== 'register') {
    throw new Error('Неизвестная операция регистрации');
  }

  const body = new URLSearchParams();

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  });

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 30000);

  try {
    // Отправляем POST. Ответ намеренно непрозрачный,
    // поэтому response.ok и response.status не проверяем.
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
    if (error.name === 'AbortError') {
      throw new Error(
        'Время отправки запроса истекло. Проверь выполнение doPost в Apps Script.'
      );
    }

    throw new Error(
      'Не удалось отправить запрос в Google Apps Script. Проверь интернет-соединение.'
    );
  } finally {
    clearTimeout(timeout);
  }

  // Проверяем результат в общей Google Таблице.
  // Apps Script может завершить запись немного позже HTTP-ответа.
  let lastError = null;

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const participant = await getGasJsonp('participant', {
        vk_user_id: userId,
      });

      if (!participant?.ok) {
        throw new Error(
          participant?.error || 'Ошибка проверки участника'
        );
      }

      if (participant.registered) {
        const stats = await getGasJsonp('stats');

        return {
          ok: true,
          status: 'registered',
          message: 'Регистрация успешно подтверждена Google Таблицей!',
          registeredCount: Number(stats?.registeredCount) || 0,
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
