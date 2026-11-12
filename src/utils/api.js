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
 * POST-запрос через скрытый iframe.
 * Используется для регистрации без CORS-запроса.
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

    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      frame.remove();
      form.remove();
    };

    const handleMessage = (event) => {
      if (event.source !== frame.contentWindow) {
        return;
      }

      if (
        !event.data ||
        event.data.type !== 'STEP_CHALLENGE_GAS_RESPONSE'
      ) {
        return;
      }

      cleanup();
      resolve(event.data.data);
    };

    window.addEventListener('message', handleMessage);

    timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error('Google Apps Script не вернул ответ на регистрацию')
      );
    }, 30000);

    document.body.appendChild(frame);
    document.body.appendChild(form);

    form.submit();
  });
}