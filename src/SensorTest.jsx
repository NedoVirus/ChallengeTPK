import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './SensorTest.css';

const START_METHOD = 'VKWebAppAccelerometerStart';
const STOP_METHOD = 'VKWebAppAccelerometerStop';
const EVENT_NAME = 'VKWebAppAccelerometerChanged';

const getPlatformInfo = () => {
  const params = new URLSearchParams(window.location.search);
  const vkPlatform = params.get('vk_platform') || 'не определена';
  const userAgent = navigator.userAgent;

  let device = 'Неизвестное устройство';

  if (/android/i.test(userAgent)) {
    device = 'Android';
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    device = 'iOS';
  } else if (/windows/i.test(userAgent)) {
    device = 'Windows';
  }

  return {
    device,
    vkPlatform,
    userAgent,
  };
};

const formatValue = (value) => {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return value.toFixed(3);
};

export const SensorTest = () => {
  const [status, setStatus] = useState('idle');
  const [supportStatus, setSupportStatus] = useState('Проверяется...');
  const [latest, setLatest] = useState(null);
  const [eventCount, setEventCount] = useState(0);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [startResponse, setStartResponse] = useState('');

  const subscribedRef = useRef(false);
  const runningRef = useRef(false);
  const startingRef = useRef(false);
  const eventIdRef = useRef(0);

  const platform = getPlatformInfo();

  const handleBridgeEvent = useCallback((event) => {
    const detail = event?.detail;

    if (!detail || detail.type !== EVENT_NAME) {
      return;
    }

    const data = detail.data || {};

    const x = Number(data.x);
    const y = Number(data.y);
    const z = Number(data.z);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      setError(
        `Получено событие ${EVENT_NAME}, но координаты имеют неизвестный формат.`
      );
      return;
    }

    const magnitude = Math.sqrt(
      x * x + y * y + z * z
    );

    const time = new Date().toLocaleTimeString('ru-RU');

    setLatest({
      x,
      y,
      z,
      magnitude,
      time,
    });

    setEventCount((previous) => previous + 1);

    const newEvent = {
      id: ++eventIdRef.current,
      x,
      y,
      z,
      magnitude,
      time,
      raw: JSON.stringify(data),
    };

    setEvents((previous) => [
      newEvent,
      ...previous,
    ].slice(0, 12));
  }, []);

  useEffect(() => {
    try {
      if (typeof bridge.supports === 'function') {
        const supported = bridge.supports(START_METHOD);

        setSupportStatus(
          supported
            ? 'Метод заявлен как поддерживаемый'
            : 'Метод не заявлен как поддерживаемый'
        );
      } else {
        setSupportStatus(
          'Проверка поддержки методом supports() недоступна'
        );
      }
    } catch (err) {
      setSupportStatus(
        'Не удалось проверить поддержку метода'
      );
    }

    return () => {
      if (subscribedRef.current) {
        bridge.unsubscribe(handleBridgeEvent);
        subscribedRef.current = false;
      }

      if (runningRef.current) {
        bridge.send(STOP_METHOD).catch((err) => {
          console.warn(
            'Не удалось остановить акселерометр:',
            err
          );
        });

        runningRef.current = false;
      }
    };
  }, [handleBridgeEvent]);

  const startSensor = async () => {
    if (startingRef.current || runningRef.current) {
      return;
    }

    startingRef.current = true;

    setStatus('starting');
    setError('');
    setStartResponse('');

    try {
      if (!subscribedRef.current) {
        bridge.subscribe(handleBridgeEvent);
        subscribedRef.current = true;
      }

      const response = await bridge.send(START_METHOD);

      runningRef.current = true;

      setStartResponse(
        JSON.stringify(response ?? {})
      );

      setStatus('running');
    } catch (err) {
      if (subscribedRef.current) {
        bridge.unsubscribe(handleBridgeEvent);
        subscribedRef.current = false;
      }

      runningRef.current = false;

      setStatus('error');

      setError(
        err?.message ||
        err?.error_data?.error_reason ||
        'Не удалось запустить акселерометр.'
      );

      console.error(
        '[STEP CHALLENGE SENSOR]',
        err
      );
    } finally {
      startingRef.current = false;
    }
  };

  const stopSensor = async () => {
    setStatus('stopping');
    setError('');

    try {
      if (runningRef.current) {
        await bridge.send(STOP_METHOD);
      }

      setStatus('stopped');
    } catch (err) {
      setError(
        err?.message ||
        'Ошибка при остановке акселерометра.'
      );

      setStatus('error');
    } finally {
      runningRef.current = false;

      if (subscribedRef.current) {
        bridge.unsubscribe(handleBridgeEvent);
        subscribedRef.current = false;
      }
    }
  };

  const resetData = () => {
    setLatest(null);
    setEventCount(0);
    setEvents([]);
    setError('');
    setStartResponse('');
    eventIdRef.current = 0;
  };

  const statusLabels = {
    idle: 'Ожидание запуска',
    starting: 'Запуск датчика...',
    running: 'Датчик работает',
    stopping: 'Остановка...',
    stopped: 'Датчик остановлен',
    error: 'Ошибка',
  };

  const statusColors = {
    idle: 'neutral',
    starting: 'warning',
    running: 'success',
    stopping: 'warning',
    stopped: 'neutral',
    error: 'danger',
  };

  return (
    <main className="sensor-test">
      <header className="sensor-header">
        <div>
          <div className="sensor-brand">
            STEP CHALLENGE
          </div>

          <h1>Тест датчиков</h1>

          <p>
            Проверка акселерометра через VK Bridge
          </p>
        </div>

        <div className="sensor-icon">
          👟
        </div>
      </header>

      <section className="sensor-card sensor-main-card">
        <div className="sensor-status-row">
          <span className="sensor-label">
            Состояние датчика
          </span>

          <span
            className={`sensor-badge ${statusColors[status]}`}
          >
            {statusLabels[status]}
          </span>
        </div>

        <div className="sensor-event-number">
          {eventCount.toLocaleString('ru-RU')}
        </div>

        <div className="sensor-event-caption">
          Получено событий акселерометра
        </div>

        <div className="sensor-actions">
          <button
            className="sensor-button primary"
            onClick={startSensor}
            disabled={
              status === 'running' ||
              status === 'starting' ||
              status === 'stopping'
            }
          >
            Запустить датчик
          </button>

          <button
            className="sensor-button secondary"
            onClick={stopSensor}
            disabled={
              status !== 'running' &&
              status !== 'starting'
            }
          >
            Остановить
          </button>

          <button
            className="sensor-button reset"
            onClick={resetData}
            disabled={status === 'running'}
          >
            Сбросить
          </button>
        </div>

        <div className="sensor-notice">
          Это количество полученных событий, а не шагов.
          Подсчёт настоящих шагов мы будем разрабатывать
          отдельно после проверки датчика.
        </div>
      </section>

      <section className="sensor-card">
        <h2>Показания акселерометра</h2>

        <div className="sensor-coordinates">
          <div className="sensor-axis">
            <span className="axis-name">X</span>
            <strong>
              {formatValue(latest?.x)}
            </strong>
          </div>

          <div className="sensor-axis">
            <span className="axis-name">Y</span>
            <strong>
              {formatValue(latest?.y)}
            </strong>
          </div>

          <div className="sensor-axis">
            <span className="axis-name">Z</span>
            <strong>
              {formatValue(latest?.z)}
            </strong>
          </div>
        </div>

        <div className="sensor-magnitude">
          <span>Общая величина ускорения</span>
          <strong>
            {formatValue(latest?.magnitude)}
          </strong>
        </div>

        <div className="sensor-last-update">
          Последнее обновление: {latest?.time || 'нет данных'}
        </div>
      </section>

      <section className="sensor-card">
        <h2>Диагностика VK Bridge</h2>

        <div className="sensor-info-row">
          <span>Устройство</span>
          <strong>{platform.device}</strong>
        </div>

        <div className="sensor-info-row">
          <span>VK Platform</span>
          <strong>{platform.vkPlatform}</strong>
        </div>

        <div className="sensor-info-row">
          <span>Поддержка метода</span>
          <strong>{supportStatus}</strong>
        </div>

        <div className="sensor-info-row">
          <span>Событие</span>
          <strong>{EVENT_NAME}</strong>
        </div>

        <div className="sensor-info-row">
          <span>Команда запуска</span>
          <strong>{START_METHOD}</strong>
        </div>

        {startResponse && (
          <div className="sensor-response">
            <span>Ответ на запуск:</span>
            <code>{startResponse}</code>
          </div>
        )}
      </section>

      {error && (
        <section className="sensor-card sensor-error">
          <h2>Сообщение об ошибке</h2>
          <p>{error}</p>
        </section>
      )}

      <section className="sensor-card">
        <div className="sensor-section-heading">
          <h2>Журнал событий</h2>

          <span>{events.length} последних</span>
        </div>

        {events.length === 0 ? (
          <div className="sensor-empty">
            Пока нет событий.
            Нажми «Запустить датчик».
          </div>
        ) : (
          <div className="sensor-event-list">
            {events.map((event) => (
              <div
                className="sensor-event"
                key={event.id}
              >
                <div className="sensor-event-heading">
                  <strong>{event.time}</strong>
                  <span>
                    Ускорение: {formatValue(event.magnitude)}
                  </span>
                </div>

                <div className="sensor-event-values">
                  X: {formatValue(event.x)}
                  {' · '}
                  Y: {formatValue(event.y)}
                  {' · '}
                  Z: {formatValue(event.z)}
                </div>

                <code>{event.raw}</code>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="sensor-instructions">
        <h2>Как провести тест</h2>

        <ol>
          <li>
            Открой приложение в официальном клиенте VK
            на Android.
          </li>
          <li>
            Нажми «Запустить датчик».
          </li>
          <li>
            Подожди несколько секунд и посмотри,
            меняются ли координаты.
          </li>
          <li>
            Пройдись примерно 100 шагов с телефоном
            в кармане.
          </li>
          <li>
            Останови датчик и сохрани результаты
            тестирования.
          </li>
        </ol>
      </section>

      <footer className="sensor-footer">
        STEP CHALLENGE · SENSOR DIAGNOSTICS
      </footer>
    </main>
  );
};