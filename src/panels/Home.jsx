import { useEffect, useRef, useState } from 'react';
import { Panel, PanelHeader } from '@vkontakte/vkui';
import PropTypes from 'prop-types';

import { getGasJsonp, postGasForm } from '../utils/api';
import './Home.css';

const DAYS = [1, 2, 3, 4, 5];

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
};

export const Home = ({ id, fetchedUser, launchParams }) => {
  const [activeTab, setActiveTab] = useState('home');

  const [participantsCount, setParticipantsCount] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registrationChecked, setRegistrationChecked] = useState(false);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState('');
  const [registrationMessageType, setRegistrationMessageType] =
    useState('');

  const rulesRef = useRef(null);

  const {
    photo_200,
    city,
    first_name,
    last_name,
  } = fetchedUser || {};

  const fullName =
    [first_name, last_name].filter(Boolean).join(' ') || 'Участник';

  const initials =
    [first_name?.[0], last_name?.[0]]
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

  /* =====================================
     ЗАГРУЗКА КОЛИЧЕСТВА УЧАСТНИКОВ
  ===================================== */

  useEffect(() => {
    let active = true;

    getGasJsonp('stats')
      .then((data) => {
        if (!active || !data?.ok) {
          return;
        }

        setParticipantsCount(
          Number(data.registeredCount) || 0
        );
      })
      .catch((error) => {
        console.warn('Ошибка загрузки статистики:', error);
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
      .then((data) => {
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
      .catch((error) => {
        if (!active) {
          return;
        }

        console.warn('Ошибка проверки регистрации:', error);

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

      if (!result || !result.ok) {
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
                color:
                  registrationMessageType === 'success'
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
            Подключение и проверка шагов появятся после настройки системы учёта.
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
          {DAYS.map((day) => (
            <div className="step-day" key={day}>
              <div className="step-day-number">
                {String(day).padStart(2, '0')}
              </div>

              <div className="step-day-info">
                <strong>День {day}</strong>
                <span>10 000 шагов</span>
              </div>

              <span className="step-day-status">
                Скоро
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
                Челлендж длится пять дней подряд.
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
              <strong>Попади в рейтинг</strong>
              <p>
                Итоговое положение зависит от количества подтверждённых шагов.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );

  /* =====================================
     РЕЙТИНГ
  ===================================== */

  const renderRating = () => (
    <section className="step-inner-page">
      <span className="step-overline">STEP CHALLENGE</span>
      <h1>Рейтинг</h1>

      <p className="step-page-description">
        Здесь будут отображаться результаты всех участников.
      </p>

      <div className="step-empty-card">
        <div className="step-empty-icon">🏆</div>

        <h2>Пока нет рейтинга</h2>

        <p>
          Таблица лидеров появится после начала челленджа
          и поступления подтверждённых результатов.
        </p>
      </div>
    </section>
  );

  /* =====================================
     ПРОФИЛЬ
  ===================================== */

  const renderProfile = () => (
    <section className="step-inner-page">
      <span className="step-overline">ЛИЧНЫЙ КАБИНЕТ</span>
      <h1>Мой профиль</h1>

      <div className="step-profile-card">
        <div className="step-avatar-large">
          {photo_200 ? (
            <img src={photo_200} alt="Аватар пользователя" />
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