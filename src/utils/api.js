
const API_URL =
  'https://script.google.com/macros/s/AKfycby131tLHIX7DyqQFXkBxH0tkdd3pX6Qy0EfKCTsqb4RSVRmIjTvQWv2E7PzbPu8WpDiXQ/exec';

let callbackCounter = 0;

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
      reject(new Error('Не удалось подключиться к Google Apps Script'));
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Превышено время ожидания ответа сервера'));
    }, 15000);

    script.async = true;
    script.src = url.toString();

    document.head.appendChild(script);
  });
}

/**
 * Отправка POST через скрытый iframe.
 *
 * После завершения запроса не используем postMessage
 * из HtmlService, а проверяем фактическую запись в Sheets.
 */
export function postGasForm(payload) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    const form = document.createElement('form');

    const frameName =
      `stepChallengeFrame${Date.now()}${++callbackCounter}`;

    frame.name = frameName;
    frame.title = 'STEP CHALLENGE API';

    frame.style.position = 'absolute';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.left = '-9999px';

    form.method = 'POST';
    form.action = API_URL;
    form.target = frameName;
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

    let timeout;
    let loadCount = 0;
    let finished = false;

    const cleanup = () => {
      clearTimeout(timeout);
      frame.removeEventListener('load', handleFrameLoad);
      frame.remove();
      form.remove();
    };

    const fail = (error) => {
      if (finished) return;

      finished = true;
      cleanup();

      reject(
        error instanceof Error
          ? error
          : new Error(String(error))
      );
    };

    const verifyRegistration = async () => {
      const userId = String(payload.vk_user_id || '');

      if (!/^\d+$/.test(userId)) {
        throw new Error('Некорректный VK ID');
      }

      // Проверяем, появилась ли запись в Google Таблице.
      const participant = await getGasJsonp('participant', {
        vk_user_id: userId,
      });

      if (!participant?.ok) {
        throw new Error(
          'Не удалось проверить регистрацию в Google Таблице'
        );
      }

      if (!participant.registered) {
        throw new Error(
          'Google Таблица не подтвердила регистрацию. Проверь журнал Apps Script.'
        );
      }

      // Получаем актуальное количество участников.
      const stats = await getGasJsonp('stats');

      return {
        ok: true,
        status: 'registered',
        message: 'Регистрация успешно подтверждена Google Таблицей!',
        registeredCount: Number(stats?.registeredCount) || 0,
      };
    };

    const handleFrameLoad = async () => {
      if (finished) return;

      loadCount++;

      // Первое событие — загрузка about:blank.
      // После него отправляем форму.
      if (loadCount === 1) {
        try {
          form.submit();
          form.remove();
        } catch (error) {
          fail(error);
        }

        return;
      }

      // Второе событие — загрузился ответ Google Apps Script.
      finished = true;
      cleanup();

      try {
        const result = await verifyRegistration();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    frame.addEventListener('load', handleFrameLoad);

    timeout = setTimeout(() => {
      fail(
        new Error(
          'Google Apps Script не завершил запрос за 60 секунд'
        )
      );
    }, 60000);

    // Загружаем iframe, после чего отправляем POST.
    frame.src = 'about:blank';

    document.body.appendChild(frame);
    document.body.appendChild(form);
  });
}
