import { useEffect, useRef, useState } from 'react';
import { Panel, PanelHeader } from '@vkontakte/vkui';
import PropTypes from 'prop-types';

import { getGasJsonp, postGasForm, submitStepsResult } from '../utils/api';
import './Home.css';

const CHALLENGE_DAYS = [
  { value: '2026-11-23', label: 'Понедельник, 23 ноября', number: 1 },
  { value: '2026-11-24', label: 'Вторник, 24 ноября', number: 2 },
  { value: '2026-11-25', label: 'Среда, 25 ноября', number: 3 },
  { value: '2026-11-26', label: 'Четверг, 26 ноября', number: 4 },
  { value: '2026-11-27', label: 'Пятница, 27 ноября', number: 5 },
];

const MAX_SCREENSHOT_SIZE = 4 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

const ERROR_MESSAGES = {
  server_not_configured:
    'Не настроены VK_APP_ID или VK_APP_SECRET в Apps Script.',
  vk_signature_missing:
    'Отсутствует подпись запуска VK. Открой приложение через VK.',
  vk_params_missing:
    'Не удалось получить параметры запуска VK.',
  invalid_vk_app_id:
    'ID приложения VK не совпадает с настройками сервера.',
  invalid_vk_user_id:
    'Не удалось определить пользователя VK.',
  invalid_vk_signature:
    'VK не подтвердил подлинность запуска. Перезапусти приложение.',
  unknown_action:
    'Неизвестная операция сервера.',
  participant_not_registered:
    'Сначала необходимо зарегистрироваться в челлендже.',
  invalid_challenge_date:
    'Выбрана дата вне периода челленджа.',
  future_challenge_date:
    'Результат за этот день пока нельзя отправить.',
  challenge_not_active:
    'На выбранную дату челлендж не активен. Проверь лист «Челленджи».',
  invalid_steps:
    'Укажи количество шагов от 1 до 100 000.',
  invalid_image_type:
    'Можно загрузить только JPG, PNG или WEBP.',
  invalid_image_size:
    'Размер скриншота не должен превышать 4 МБ.',
  invalid_image_data:
    'Не удалось прочитать изображение. Выбери скриншот ещё раз.',
};


function getLocalDateString() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}


function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result || ''));
    };

    reader.onerror = () => {
      reject(
        new Error('Не удалось прочитать файл скриншота.')
      );
    };

    reader.readAsDataURL(file);
  });
}


export const Home = ({ id, fetchedUser, launchParams }) => {
  const [activeTab, setActiveTab] = useState('home');

  const [participantsCount, setParticipantsCount] = useState(null);

  const [isRegistered, setIsRegistered] = useState(false);
  const [registrationChecked, setRegistrationChecked] = useState(false);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState('');
  const [registrationMessageType, setRegistrationMessageType] = useState('');

  const [resultDate, setResultDate] = useState(
    CHALLENGE_DAYS[0].value
  );

  const [stepsValue, setStepsValue] = useState('');

  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState('');

  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [submissionMessageType, setSubmissionMessageType] = useState('');

  const [lastSubmission, setLastSubmission] = useState(null);
  const [submissionStatusLoading, setSubmissionStatusLoading] = useState(false);

  const [ratingRows, setRatingRows] = useState([]);
  const [ratingLoading, setRatingLoading] = useState(false);

  const rulesRef = useRef(null);
  const fileInputRef = useRef(null);


  const {
    photo_200,
    city,
    first_name,
    last_name,
  } = fetchedUser || {};


  const fullName =
    [first_name, last_name].filter(Boolean).join(' ') || 'Участник';


  const initials = [
    first_name?.[0],
    last_name?.[0],
  ]
    .filter(Boolean)
    .join('')
    .toUpperCase() || 'S';


  const userId = launchParams?.vk_user_id
    ? String(launchParams.vk_user_id)
    : '';


  const hasSignedLaunchParams = Boolean(
    launchParams?.vk_user_id &&
    launchParams?.vk_app_id &&
    launchParams?.sign
  );


  const signedLaunchParams = Object.fromEntries(
    Object.entries(launchParams || {}).filter(
      ([key, value]) =>
        (key.startsWith('vk_') || key === 'sign') &&
        value !== undefined &&
        value !== null
    )
  );


  // Освобождаем URL предпросмотра,
  // когда файл меняется или экран закрывается.

  useEffect(() => {
    return () => {
      if (screenshotPreview) {
        URL.revokeObjectURL(screenshotPreview);
      }
    };
  }, [screenshotPreview]);


  /* =====================================
     ЗАГРУЗКА КОЛИЧЕСТВА УЧАСТНИКОВ
  ===================================== */

  useEffect(() => {
    let active = true;

    getGasJsonp('stats')
      .then(data => {
        if (active && data?.ok) {
          setParticipantsCount(
            Number(data.registeredCount) || 0
          );
        }
      })
      .catch(error => {
        console.warn(
          'Ошибка загрузки статистики:',
          error
        );
      });

    return () => {
      active = false;
    };
  }, []);


  /* =====================================
     ПРОВЕРКА РЕГИСТРАЦИИ
  ===================================== */

  useEffect(() => {
    let active = true;

    if (!userId || !hasSignedLaunchParams) {
      setRegistrationChecked(true);

      return () => {
        active = false;
      };
    }

    setRegistrationChecked(false);

    getGasJsonp('participant', {
      vk_user_id: userId,
    })
      .then(data => {
        if (!active) {
          return;
        }

        if (data?.ok) {
          setIsRegistered(Boolean(data.registered));
        } else {
          setRegistrationMessage(
            'Не удалось проверить регистрацию.'
          );

          setRegistrationMessageType('error');
        }

        setRegistrationChecked(true);
      })
      .catch(error => {
        if (!active) {
          return;
        }

        console.warn(
          'Ошибка проверки регистрации:',
          error
        );

        setRegistrationMessage(
          'Не удалось проверить регистрацию. Попробуй зарегистрироваться.'
        );

        setRegistrationMessageType('error');
        setRegistrationChecked(true);
      });

    return () => {
      active = false;
    };
  }, [userId, hasSignedLaunchParams]);


  /* =====================================
     ПРОВЕРКА ОТПРАВКИ ЗА ВЫБРАННЫЙ ДЕНЬ
  ===================================== */

  useEffect(() => {
    let active = true;

    if (
      activeTab !== 'submit' ||
      !hasSignedLaunchParams ||
      !isRegistered
    ) {
      return () => {
        active = false;
      };
    }

    setSubmissionStatusLoading(true);
    setLastSubmission(null);

    getGasJsonp('submission_status', {
      ...signedLaunchParams,
      challenge_date: resultDate,
    })
      .then(data => {
        if (!active) {
          return;
        }

        if (data?.ok) {
          setLastSubmission(
            data.submitted ? data.submission : null
          );
        }
      })
      .catch(error => {
        console.warn(
          'Не удалось загрузить статус результата:',
          error
        );
      })
      .finally(() => {
        if (active) {
          setSubmissionStatusLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    activeTab,
    resultDate,
    hasSignedLaunchParams,
    isRegistered,
    userId,
    launchParams,
  ]);


  /* =====================================
     ЗАГРУЗКА РЕЙТИНГА
  ===================================== */

  useEffect(() => {
    let active = true;

    if (activeTab !== 'rating') {
      return () => {
        active = false;
      };
    }

    setRatingLoading(true);

    getGasJsonp('rating')
      .then(data => {
        if (active && data?.ok) {
          setRatingRows(data.rating || []);
        }
      })
      .catch(error => {
        console.warn(
          'Ошибка загрузки рейтинга:',
          error
        );
      })
      .finally(() => {
        if (active) {
          setRatingLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab]);


  /* =====================================
     РЕГИСТРАЦИЯ
  ===================================== */

  const handleRegister = async () => {
    if (!hasSignedLaunchParams) {
      setRegistrationMessage(
        'Для регистрации открой STEP CHALLENGE непосредственно через VK.'
      );

      setRegistrationMessageType('error');
      return;
    }

    if (isRegistered || registrationBusy) {
      return;
    }

    setRegistrationBusy(true);
    setRegistrationMessage('');

    try {
      const registrationData = {
        action: 'register',

        ...signedLaunchParams,

        first_name: first_name || '',
        last_name: last_name || '',
        photo_200: photo_200 || '',
        city: city?.title || '',
      };

      const result = await postGasForm(registrationData);

      if (!result?.ok) {
        throw new Error(
          ERROR_MESSAGES[result?.error] ||
          result?.error ||
          'Ошибка регистрации.'
        );
      }

      setIsRegistered(true);

      setParticipantsCount(
        Number(result.registeredCount) || participantsCount
      );

      setRegistrationMessage(
        result.message || 'Регистрация успешно завершена!'
      );

      setRegistrationMessageType('success');

    } catch (error) {
      console.error('Ошибка регистрации:', error);

      setRegistrationMessage(
        ERROR_MESSAGES[error.message] ||
        error.message ||
        'Не удалось зарегистрироваться. Попробуй ещё раз.'
      );

      setRegistrationMessageType('error');

    } finally {
      setRegistrationBusy(false);
    }
  };


  const showRules = () => {
    rulesRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };


  /* =====================================
     РАБОТА СО СКРИНШОТОМ
  ===================================== */

  const removeScreenshot = () => {
    if (screenshotPreview) {
      URL.revokeObjectURL(screenshotPreview);
    }

    setScreenshotFile(null);
    setScreenshotPreview('');

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };


  const handleScreenshotChange = (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setSubmissionMessage(
        'Поддерживаются форматы JPG, PNG и WEBP.'
      );

      setSubmissionMessageType('error');
      event.target.value = '';

      return;
    }

    if (file.size > MAX_SCREENSHOT_SIZE) {
      setSubmissionMessage(
        'Скриншот слишком большой. Максимальный размер — 4 МБ.'
      );

      setSubmissionMessageType('error');
      event.target.value = '';

      return;
    }

    if (screenshotPreview) {
      URL.revokeObjectURL(screenshotPreview);
    }

    setScreenshotFile(file);
    setScreenshotPreview(URL.createObjectURL(file));

    setSubmissionMessage('');
    setSubmissionMessageType('');
  };


  /* =====================================
     ОТПРАВКА РЕЗУЛЬТАТА
  ===================================== */

  const handleSubmitResult = async () => {
    if (!hasSignedLaunchParams) {
      setSubmissionMessage(
        'Открой STEP CHALLENGE непосредственно через VK.'
      );

      setSubmissionMessageType('error');
      return;
    }

    if (!isRegistered) {
      setSubmissionMessage(
        'Сначала зарегистрируйся в челлендже.'
      );

      setSubmissionMessageType('error');
      return;
    }

    const steps = Number(stepsValue);

    if (
      !Number.isInteger(steps) ||
      steps < 1 ||
      steps > 100000
    ) {
      setSubmissionMessage(
        'Укажи количество шагов от 1 до 100 000.'
      );

      setSubmissionMessageType('error');
      return;
    }

    if (!screenshotFile) {
      setSubmissionMessage(
        'Сначала выбери скриншот Google Fit.'
      );

      setSubmissionMessageType('error');
      return;
    }

    // Не даём отправить данные за будущий день.
    // Повторная проверка выполняется также на сервере.

    if (resultDate > getLocalDateString()) {
      setSubmissionMessage(
        'Отправить результат за выбранный день можно только в этот день или позже.'
      );

      setSubmissionMessageType('error');
      return;
    }

    if (
      lastSubmission &&
      ['На проверке', 'Одобрено'].includes(lastSubmission.status)
    ) {
      setSubmissionMessage(
        lastSubmission.status === 'На проверке'
          ? 'За этот день результат уже находится на проверке.'
          : 'За этот день результат уже одобрен.'
      );

      setSubmissionMessageType('error');
      return;
    }

    setSubmissionBusy(true);

    setSubmissionMessage(
      'Отправляем скриншот и сохраняем результат...'
    );

    setSubmissionMessageType('info');

    try {
      const dataUrl = await readFileAsDataUrl(screenshotFile);
      const base64 = dataUrl.split(',')[1] || '';

      const result = await submitStepsResult({
        action: 'submit_result',

        ...signedLaunchParams,

        signed_launch_params: signedLaunchParams,

        challenge_date: resultDate,
        steps,

        phone_time: new Date().toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        }),

        file_name: screenshotFile.name,
        mime_type: screenshotFile.type,
        image_base64: base64,
      });

      setLastSubmission(
        result.submission || {
          steps,
          status: result.status || 'На проверке',
          submittedAt: new Date().toISOString(),
          comment: '',
        }
      );

      setSubmissionMessage(
        result.message || 'Скриншот отправлен на проверку.'
      );

      setSubmissionMessageType('success');

      removeScreenshot();

    } catch (error) {
      console.error(
        'Ошибка отправки результата:',
        error
      );

      setSubmissionMessage(
        ERROR_MESSAGES[error.message] ||
        error.message ||
        'Не удалось отправить результат. Попробуй ещё раз.'
      );

      setSubmissionMessageType('error');

    } finally {
      setSubmissionBusy(false);
    }
  };


  const formatSubmissionDate = (value) => {
    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };


  /* =====================================
     ГЛАВНАЯ СТРАНИЦА
  ===================================== */

  const renderHome = () => (
    <>
      <section className="step-hero">
        <div className="step-hero-decoration step-decoration-one" />
        <div className="step-hero-decoration step-decoration-two" />

        <div className="step-hero-content">
          <div className="step-hero-label">
            <span className="step-live-dot" />
            ПЯТИДНЕВНЫЙ ЧЕЛЛЕНДЖ
          </div>

          <h1>
            Двигайся
            <br />
            <span>к своей цели.</span>
          </h1>

          <p>
            Пять дней активности, тысячи шагов
            и общий вызов для тех, кто не любит стоять на месте.
          </p>

          <button
            className="step-primary-button"
            onClick={handleRegister}
            type="button"
            disabled={
              !hasSignedLaunchParams ||
              !registrationChecked ||
              registrationBusy ||
              isRegistered
            }
          >
            {isRegistered
              ? 'Вы участвуете'
              : registrationBusy
                ? 'Регистрируем...'
                : !hasSignedLaunchParams
                  ? 'Откройте через VK'
                  : !registrationChecked
                    ? 'Проверяем...'
                    : 'Участвовать'}

            <span>↗</span>
          </button>

          {!hasSignedLaunchParams && (
            <p style={{
              marginTop: '12px',
              fontSize: '11px',
              color: 'rgba(255,255,255,0.65)',
            }}>
              Регистрация доступна при открытии приложения внутри VK.
            </p>
          )}

          {registrationMessage && (
            <p
              role="status"
              style={{
                marginTop: '13px',
                fontSize: '12px',
                lineHeight: 1.5,
                color: registrationMessageType === 'success'
                  ? '#c8f36d'
                  : '#ffaaa4',
              }}
            >
              {registrationMessage}
            </p>
          )}

          <button
            type="button"
            onClick={showRules}
            style={{
              display: 'block',
              marginTop: '15px',
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: 'rgba(255,255,255,0.7)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Посмотреть правила ↓
          </button>
        </div>

        <div className="step-hero-bottom">
          <div className="step-hero-stat">
            <strong>05</strong>
            <span>дней</span>
          </div>

          <div className="step-hero-divider" />

          <div className="step-hero-stat">
            <strong>10K</strong>
            <span>шагов в день</span>
          </div>

          <div className="step-hero-divider" />

          <div className="step-hero-stat">
            <strong>50K</strong>
            <span>за челлендж</span>
          </div>
        </div>
      </section>


      {/* Отправка дневного результата */}

      <section className="step-section">
        <div className="step-section-heading">
          <div>
            <span className="step-overline">ЕЖЕДНЕВНЫЙ ОТЧЁТ</span>
            <h2>Отправить шаги</h2>
          </div>
        </div>

        <p style={{
          color: 'var(--vkui--color_text_secondary, #777)',
          lineHeight: 1.5,
        }}>
          Загрузи скриншот Google Fit за выбранный день.
          После отправки результат проверит модератор.
        </p>

        <button
          type="button"
          className="step-primary-button"
          style={{
            width: '100%',
            marginTop: '12px',
          }}
          onClick={() => {
            setActiveTab('submit');
            setSubmissionMessage('');
          }}
          disabled={!isRegistered || !hasSignedLaunchParams}
        >
          {isRegistered
            ? 'Загрузить скриншот Google Fit'
            : 'Сначала зарегистрируйся'}

          <span>↗</span>
        </button>
      </section>


      <section className="step-section">
        <div className="step-section-heading">
          <div>
            <span className="step-overline">ТВОЯ АКТИВНОСТЬ</span>
            <h2>Твоя цель</h2>
          </div>

          <span className="step-section-caption">
            Каждый день
          </span>
        </div>

        <div className="step-goal-card">
          <div className="step-goal-top">
            <span className="step-goal-icon">↗</span>

            <span className="step-goal-status">
              Ожидает запуска
            </span>
          </div>

          <div className="step-goal-number">
            10 000
            <span>шагов</span>
          </div>

          <div className="step-progress-track">
            <div className="step-progress-fill" />
          </div>

          <div className="step-goal-bottom">
            <span>Данные ещё не загружены</span>
            <span>— / 10 000</span>
          </div>

          <div className="step-goal-note">
            <span>ⓘ</span>
            Результаты появятся здесь после проверки модератором.
          </div>
        </div>
      </section>


      <section className="step-info-grid">
        <div className="step-info-card">
          <div className="step-info-icon green">◷</div>
          <strong>5 дней</strong>
          <span>Продолжительность</span>
        </div>

        <div className="step-info-card">
          <div className="step-info-icon purple">◎</div>
          <strong>50 000</strong>
          <span>Цель за 5 дней</span>
        </div>

        <div className="step-info-card">
          <div className="step-info-icon orange">♙</div>

          <strong>
            {participantsCount === null
              ? '—'
              : participantsCount.toLocaleString('ru-RU')}
          </strong>

          <span>Зарегистрировано</span>
        </div>
      </section>


      <section className="step-section">
        <div className="step-section-heading">
          <div>
            <span className="step-overline">ТВОЙ МАРШРУТ</span>
            <h2>Пять дней движения</h2>
          </div>
        </div>

        <div className="step-days-card">
          {CHALLENGE_DAYS.map(day => (
            <div className="step-day" key={day.value}>
              <div className="step-day-number">
                {String(day.number).padStart(2, '0')}
              </div>

              <div className="step-day-info">
                <strong>{day.label}</strong>
                <span>Цель — 10 000 шагов</span>
              </div>

              <span className="step-day-status">
                День {day.number}
              </span>
            </div>
          ))}
        </div>
      </section>


      <section
        className="step-section step-rules-section"
        ref={rulesRef}
        id="challenge-rules"
      >
        <div className="step-section-heading">
          <div>
            <span className="step-overline">ПРАВИЛА</span>
            <h2>Как это работает?</h2>
          </div>
        </div>

        <div className="step-rule-card">
          <div className="step-rule">
            <span className="step-rule-number">01</span>

            <div>
              <strong>Участвуй пять дней</strong>
              <p>
                Челлендж длится с 23 по 27 ноября 2026 года.
              </p>
            </div>
          </div>

          <div className="step-rule">
            <span className="step-rule-number">02</span>

            <div>
              <strong>Достигай своей цели</strong>
              <p>
                Ежедневная цель — 10 000 шагов.
              </p>
            </div>
          </div>

          <div className="step-rule">
            <span className="step-rule-number">03</span>

            <div>
              <strong>Отправляй скриншот</strong>
              <p>
                Каждый дневной результат проверяется модератором.
              </p>
            </div>
          </div>

          <div className="step-rule">
            <span className="step-rule-number">04</span>

            <div>
              <strong>Попади в рейтинг</strong>
              <p>
                Учитываются только одобренные результаты.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );


  /* =====================================
     ОТПРАВКА РЕЗУЛЬТАТА
  ===================================== */

  const renderSubmit = () => {
    const hasPendingOrApproved = lastSubmission &&
      ['На проверке', 'Одобрено'].includes(lastSubmission.status);

    const statusColor = lastSubmission?.status === 'Одобрено'
      ? '#247a43'
      : lastSubmission?.status === 'Отклонено'
        ? '#c34b43'
        : '#9a751c';

    return (
      <section
        className="step-inner-page"
        style={{ paddingBottom: '24px' }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          style={{
            border: 'none',
            background: 'transparent',
            padding: '8px 0',
            color: 'var(--vkui--color_text_link, #2678d8)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ← На главную
        </button>

        <span className="step-overline">
          ЕЖЕДНЕВНЫЙ ОТЧЁТ
        </span>

        <h1>Отправить результат</h1>

        <p className="step-page-description">
          Выбери день, укажи общее количество шагов
          и приложи скриншот из Google Fit.
        </p>

        <div style={{
          padding: '15px',
          margin: '16px 0',
          borderRadius: '16px',
          background: 'var(--vkui--color_background_secondary, #f3f4f5)',
          color: 'var(--vkui--color_text_primary, #222)',
          lineHeight: 1.5,
          fontSize: '13px',
        }}>
          <strong style={{
            display: 'block',
            marginBottom: '6px',
          }}>
            Что должно быть видно на скриншоте
          </strong>

          Дата и день недели, общее количество шагов,
          график Google Fit и время в верхней строке телефона.
          Не обрезай верхнюю часть экрана.

          <span style={{
            display: 'block',
            marginTop: '7px',
            opacity: 0.75,
          }}>
            Все изображения сначала проверяются модератором.
            Наличие дополнительных карточек активности
            автоматически не отклоняет заявку.
          </span>
        </div>


        <label style={{
          display: 'block',
          fontWeight: 600,
          margin: '18px 0 7px',
        }}>
          День челленджа
        </label>

        <select
          value={resultDate}
          onChange={event => {
            setResultDate(event.target.value);
            setLastSubmission(null);
            setStepsValue('');
            removeScreenshot();
            setSubmissionMessage('');
          }}
          disabled={submissionBusy}
          style={{
            width: '100%',
            padding: '13px 12px',
            borderRadius: '12px',
            border: '1px solid var(--vkui--color_field_border, #c8c8c8)',
            background: 'var(--vkui--color_field_background, #fff)',
            color: 'var(--vkui--color_text_primary, #222)',
            fontSize: '14px',
          }}
        >
          {CHALLENGE_DAYS.map(day => (
            <option key={day.value} value={day.value}>
              День {day.number} — {day.label}
            </option>
          ))}
        </select>


        <label
          htmlFor="step-result-count"
          style={{
            display: 'block',
            fontWeight: 600,
            margin: '18px 0 7px',
          }}
        >
          Количество шагов за день
        </label>

        <input
          id="step-result-count"
          type="number"
          inputMode="numeric"
          min="1"
          max="100000"
          step="1"
          placeholder="Например, 12359"
          value={stepsValue}
          onChange={event => setStepsValue(event.target.value)}
          disabled={submissionBusy}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '13px 12px',
            borderRadius: '12px',
            border: '1px solid var(--vkui--color_field_border, #c8c8c8)',
            background: 'var(--vkui--color_field_background, #fff)',
            color: 'var(--vkui--color_text_primary, #222)',
            fontSize: '16px',
          }}
        />


        <label style={{
          display: 'block',
          fontWeight: 600,
          margin: '18px 0 7px',
        }}>
          Скриншот Google Fit
        </label>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleScreenshotChange}
          disabled={submissionBusy || Boolean(hasPendingOrApproved)}
          style={{
            width: '100%',
            fontSize: '13px',
          }}
        />

        <p style={{
          margin: '7px 0 0',
          fontSize: '12px',
          opacity: 0.7,
          lineHeight: 1.45,
        }}>
          JPG, PNG или WEBP. Максимальный размер файла — 4 МБ.
        </p>


        {screenshotPreview && (
          <div style={{
            marginTop: '14px',
            padding: '10px',
            borderRadius: '14px',
            border: '1px solid var(--vkui--color_separator_primary, #ddd)',
          }}>
            <img
              src={screenshotPreview}
              alt="Предпросмотр скриншота Google Fit"
              style={{
                display: 'block',
                width: '100%',
                maxHeight: '420px',
                objectFit: 'contain',
                borderRadius: '8px',
              }}
            />

            <button
              type="button"
              onClick={removeScreenshot}
              disabled={submissionBusy}
              style={{
                marginTop: '10px',
                border: 'none',
                background: 'transparent',
                color: '#c34b43',
                padding: '6px 0',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Удалить скриншот
            </button>
          </div>
        )}


        {submissionStatusLoading && (
          <p style={{
            fontSize: '13px',
            opacity: 0.7,
            marginTop: '14px',
          }}>
            Проверяем, отправлялся ли результат за этот день...
          </p>
        )}


        {lastSubmission && (
          <div style={{
            marginTop: '16px',
            padding: '13px',
            borderRadius: '12px',
            background: 'var(--vkui--color_background_secondary, #f3f4f5)',
            borderLeft: `4px solid ${statusColor}`,
          }}>
            <strong style={{
              display: 'block',
              color: statusColor,
              marginBottom: '5px',
            }}>
              {lastSubmission.status}
            </strong>

            <span style={{
              fontSize: '13px',
              lineHeight: 1.5,
            }}>
              Отправлено шагов: {Number(
                lastSubmission.steps || 0
              ).toLocaleString('ru-RU')}

              {lastSubmission.submittedAt
                ? ` · ${formatSubmissionDate(lastSubmission.submittedAt)}`
                : ''}
            </span>

            {lastSubmission.comment && (
              <p style={{
                margin: '8px 0 0',
                fontSize: '13px',
              }}>
                Комментарий модератора: {lastSubmission.comment}
              </p>
            )}

            {lastSubmission.status === 'Отклонено' && (
              <p style={{
                margin: '8px 0 0',
                fontSize: '12px',
              }}>
                Можно исправить данные и отправить новый скриншот за этот день.
              </p>
            )}
          </div>
        )}


        {submissionMessage && (
          <p
            role="status"
            style={{
              marginTop: '14px',
              fontSize: '13px',
              lineHeight: 1.5,
              color: submissionMessageType === 'error'
                ? '#c34b43'
                : submissionMessageType === 'success'
                  ? '#247a43'
                  : 'var(--vkui--color_text_secondary, #777)',
            }}
          >
            {submissionMessage}
          </p>
        )}


        <button
          type="button"
          className="step-primary-button"
          onClick={handleSubmitResult}
          disabled={
            !isRegistered ||
            !hasSignedLaunchParams ||
            submissionBusy ||
            submissionStatusLoading ||
            Boolean(hasPendingOrApproved)
          }
          style={{
            width: '100%',
            marginTop: '18px',
          }}
        >
          {submissionBusy
            ? 'Отправляем...'
            : hasPendingOrApproved
              ? lastSubmission.status === 'Одобрено'
                ? 'Результат одобрен'
                : 'Уже на проверке'
              : 'Отправить на проверку'}

          {!submissionBusy && !hasPendingOrApproved && (
            <span>↗</span>
          )}
        </button>

        {!isRegistered && (
          <p style={{
            fontSize: '12px',
            marginTop: '10px',
            opacity: 0.75,
          }}>
            Сначала зарегистрируйся на главной странице челленджа.
          </p>
        )}
      </section>
    );
  };


  /* =====================================
     РЕЙТИНГ
  ===================================== */

  const renderRating = () => (
    <section className="step-inner-page">
      <span className="step-overline">
        STEP CHALLENGE
      </span>

      <h1>Рейтинг</h1>

      <p className="step-page-description">
        Здесь учитываются только результаты, одобренные модератором.
      </p>

      {ratingLoading ? (
        <div className="step-empty-card">
          <p>Загружаем рейтинг...</p>
        </div>
      ) : ratingRows.length === 0 ? (
        <div className="step-empty-card">
          <div className="step-empty-icon">🏆</div>

          <h2>Пока нет рейтинга</h2>

          <p>
            Таблица лидеров появится после одобрения первых результатов.
          </p>
        </div>
      ) : (
        <div className="step-days-card">
          {ratingRows.map(item => (
            <div className="step-day" key={item.vkUserId}>
              <div className="step-day-number">
                {item.place <= 3
                  ? ['🥇', '🥈', '🥉'][item.place - 1]
                  : item.place}
              </div>

              <div className="step-day-info">
                <strong>
                  {[
                    item.firstName,
                    item.lastName,
                  ].filter(Boolean).join(' ') || 'Участник'}
                </strong>

                <span>
                  {Number(item.steps || 0).toLocaleString('ru-RU')} шагов
                </span>
              </div>

              <span className="step-day-status">
                {item.place} место
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );


  /* =====================================
     ПРОФИЛЬ
  ===================================== */

  const renderProfile = () => (
    <section className="step-inner-page">
      <span className="step-overline">
        ЛИЧНЫЙ КАБИНЕТ
      </span>

      <h1>Мой профиль</h1>

      <div className="step-profile-card">
        <div className="step-avatar-large">
          {photo_200 ? (
            <img
              src={photo_200}
              alt="Аватар пользователя"
            />
          ) : (
            initials
          )}
        </div>

        <h2>{fullName}</h2>

        {city?.title && (
          <p>{city.title}</p>
        )}

        <span className="step-profile-status">
          {isRegistered
            ? 'Участник STEP CHALLENGE'
            : 'Пока не зарегистрирован'}
        </span>
      </div>

      <div className="step-profile-info">
        <div>
          <span>Ежедневная цель</span>
          <strong>10 000 шагов</strong>
        </div>

        <div>
          <span>Продолжительность</span>
          <strong>5 дней</strong>
        </div>

        <div>
          <span>Статус участия</span>
          <strong>
            {isRegistered ? 'Участвует' : 'Не участвует'}
          </strong>
        </div>
      </div>
    </section>
  );


  /* =====================================
     ОСНОВНОЙ ИНТЕРФЕЙС
  ===================================== */

  return (
    <Panel id={id} className="step-panel">
      <PanelHeader>STEP CHALLENGE</PanelHeader>

      <div className="step-page">
        <header className="step-header">
          <div className="step-brand">
            <div className="step-brand-logo">S</div>

            <div className="step-brand-name">
              STEP
              <span>CHALLENGE</span>
            </div>
          </div>

          <div className="step-header-user">
            <div className="step-header-user-text">
              <span>Привет,</span>
              <strong>{first_name || 'участник'}</strong>
            </div>

            <div className="step-avatar">
              {photo_200 ? (
                <img src={photo_200} alt="" />
              ) : (
                initials
              )}
            </div>
          </div>
        </header>

        {activeTab === 'home' && renderHome()}
        {activeTab === 'submit' && renderSubmit()}
        {activeTab === 'rating' && renderRating()}
        {activeTab === 'profile' && renderProfile()}

        <nav className="step-bottom-nav">
          <button
            type="button"
            className={activeTab === 'home' ? 'active' : ''}
            onClick={() => setActiveTab('home')}
          >
            <span className="step-nav-icon">⌂</span>
            <span>Главная</span>
          </button>

          <button
            type="button"
            className={activeTab === 'rating' ? 'active' : ''}
            onClick={() => setActiveTab('rating')}
          >
            <span className="step-nav-icon">♕</span>
            <span>Рейтинг</span>
          </button>

          <button
            type="button"
            className={activeTab === 'profile' ? 'active' : ''}
            onClick={() => setActiveTab('profile')}
          >
            <span className="step-nav-icon">♙</span>
            <span>Профиль</span>
          </button>
        </nav>

        <footer className="step-footer">
          STEP CHALLENGE
          <span>Каждый шаг имеет значение.</span>
        </footer>
      </div>
    </Panel>
  );
};


Home.propTypes = {
  id: PropTypes.string.isRequired,

  fetchedUser: PropTypes.shape({
    photo_200: PropTypes.string,
    first_name: PropTypes.string,
    last_name: PropTypes.string,

    city: PropTypes.shape({
      title: PropTypes.string,
    }),
  }),

  launchParams: PropTypes.object,
};