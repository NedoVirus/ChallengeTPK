import { useEffect, useRef, useState } from 'react';
import { Panel, PanelHeader } from '@vkontakte/vkui';
import PropTypes from 'prop-types';
import {
  getGasJsonp,
  postGasForm,
  submitStepsResult,
  getModerationQueue,
  getModerationImage,
  moderateSubmission,
} from '../utils/api';
import './Home.css';

const MODERATOR_VK_ID = '620583350';

const CHALLENGE_DAYS = [
  {
    value: '2026-11-23',
    label: 'Понедельник, 23 ноября',
    number: 1,
  },
  {
    value: '2026-11-24',
    label: 'Вторник, 24 ноября',
    number: 2,
  },
  {
    value: '2026-11-25',
    label: 'Среда, 25 ноября',
    number: 3,
  },
  {
    value: '2026-11-26',
    label: 'Четверг, 26 ноября',
    number: 4,
  },
  {
    value: '2026-11-27',
    label: 'Пятница, 27 ноября',
    number: 5,
  },
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
    'Челлендж не активен на выбранную дату.',
  invalid_steps:
    'Укажи количество шагов от 1 до 100 000.',
  invalid_image_type:
    'Можно загрузить только JPG, PNG или WEBP.',
  invalid_image_size:
    'Размер скриншота не должен превышать 4 МБ.',
  invalid_image_data:
    'Не удалось прочитать изображение. Выбери скриншот ещё раз.',
  moderator_access_denied:
    'У этого аккаунта нет доступа к модерации.',
  submission_not_found:
    'Заявка не найдена.',
  submission_already_reviewed:
    'Эта заявка уже была проверена.',
  invalid_first_name:
    'Укажи имя участника.',
  invalid_last_name:
    'Укажи фамилию участника.',
  invalid_group:
    'Укажи номер группы цифрами.',
};

/* =====================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
===================================== */

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

function convertImageToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');

        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const context = canvas.getContext('2d');

        if (!context) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Не удалось подготовить изображение.'));
          return;
        }

        context.drawImage(
          image,
          0,
          0,
          canvas.width,
          canvas.height
        );

        canvas.toBlob(blob => {
          URL.revokeObjectURL(objectUrl);

          if (!blob) {
            reject(
              new Error('Не удалось преобразовать скриншот в JPG.')
            );
            return;
          }

          const reader = new FileReader();

          reader.onload = () => {
            resolve(String(reader.result || ''));
          };

          reader.onerror = () => {
            reject(
              new Error('Не удалось прочитать подготовленный JPG.')
            );
          };

          reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.95);

      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);

      reject(
        new Error('Браузер не смог открыть выбранное изображение.')
      );
    };

    image.src = objectUrl;
  });
}

function formatDateTime(value) {
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
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

/* =====================================
   ОСНОВНОЙ КОМПОНЕНТ
===================================== */

export const Home = ({ id, fetchedUser, launchParams }) => {
  const [activeTab, setActiveTab] = useState('home');

  // Загрузка профиля VK.
  const [profileLoading, setProfileLoading] = useState(true);

  // Регистрация.
  const [participantsCount, setParticipantsCount] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registrationChecked, setRegistrationChecked] = useState(false);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState('');
  const [registrationMessageType, setRegistrationMessageType] = useState('');

  // Мини-форма регистрации.
  const [registrationFormOpen, setRegistrationFormOpen] = useState(false);
  const [registrationFirstName, setRegistrationFirstName] = useState('');
  const [registrationLastName, setRegistrationLastName] = useState('');
  const [registrationGroup, setRegistrationGroup] = useState('');
  const [registeredParticipant, setRegisteredParticipant] = useState(null);

  // Отправка результатов.
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

  // Статусы всех пяти дней для главной страницы.
  const [homeSubmissions, setHomeSubmissions] = useState({});
  const [homeSubmissionsLoading, setHomeSubmissionsLoading] = useState(false);

  // Рейтинг.
  const [ratingRows, setRatingRows] = useState([]);
  const [ratingLoading, setRatingLoading] = useState(false);

  // Модерация.
  const [moderationSubmissions, setModerationSubmissions] = useState([]);
  const [moderationLoading, setModerationLoading] = useState(false);
  const [moderationError, setModerationError] = useState('');
  const [moderationMessage, setModerationMessage] = useState('');
  const [moderationImages, setModerationImages] = useState({});
  const [moderationImageLoading, setModerationImageLoading] = useState({});
  const [moderationComments, setModerationComments] = useState({});
  const [moderationBusyId, setModerationBusyId] = useState('');
  const [moderationReloadKey, setModerationReloadKey] = useState(0);

  const rulesRef = useRef(null);
  const fileInputRef = useRef(null);

  const {
    photo_200,
    city,
    first_name,
    last_name,
  } = fetchedUser || {};

  const displayFirstName =
    registeredParticipant?.firstName ||
    registrationFirstName ||
    first_name ||
    '';

  const displayLastName =
    registeredParticipant?.lastName ||
    registrationLastName ||
    last_name ||
    '';

  const fullName =
    [displayFirstName, displayLastName].filter(Boolean).join(' ') || 'Участник';

  const initials = [
    displayFirstName?.[0],
    displayLastName?.[0],
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

  const isModerator = userId === MODERATOR_VK_ID;

  const signedLaunchParams = Object.fromEntries(
    Object.entries(launchParams || {}).filter(
      ([key, value]) =>
        (key.startsWith('vk_') || key === 'sign') &&
        value !== undefined &&
        value !== null
    )
  );

  /* =====================================
     ЗАГРУЗКА ПРОФИЛЯ VK
  ===================================== */

  useEffect(() => {
    // Показываем главный экран только после получения
    // имени, фамилии и фотографии профиля.

    const profileIsComplete = Boolean(
      first_name &&
      last_name &&
      photo_200
    );

    if (profileIsComplete) {
      setProfileLoading(false);
      return;
    }

    // Если VK не вернул все данные,
    // не держим пользователя на загрузке бесконечно.

    const timeout = setTimeout(() => {
      setProfileLoading(false);
    }, 12000);

    return () => {
      clearTimeout(timeout);
    };
  }, [
    first_name,
    last_name,
    photo_200,
  ]);

  /* =====================================
     ОСВОБОЖДЕНИЕ ПРЕДПРОСМОТРА ФАЙЛА
  ===================================== */

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
     ПРЕДЗАПОЛНЕНИЕ ФОРМЫ ДАННЫМИ VK
  ===================================== */

  useEffect(() => {
    setRegistrationFirstName(current => current || first_name || '');
    setRegistrationLastName(current => current || last_name || '');
  }, [first_name, last_name]);

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

          if (data.registered && data.participant) {
            setRegisteredParticipant(data.participant);

            setRegistrationFirstName(
              data.participant.firstName || first_name || ''
            );

            setRegistrationLastName(
              data.participant.lastName || last_name || ''
            );

            setRegistrationGroup(data.participant.group || '');
            setRegistrationFormOpen(false);
          }
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
  }, [
    userId,
    hasSignedLaunchParams,
    first_name,
    last_name,
  ]);

  /* =====================================
     СТАТУС РЕЗУЛЬТАТА
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
            data.submitted
              ? data.submission
              : null
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
    moderationReloadKey,
  ]);

  /* =====================================
     СТАТУСЫ ПЯТИ ДНЕЙ НА ГЛАВНОЙ
  ===================================== */

  useEffect(() => {
    let active = true;

    if (
      activeTab !== 'home' ||
      !hasSignedLaunchParams ||
      !isRegistered
    ) {
      setHomeSubmissions({});
      setHomeSubmissionsLoading(false);

      return () => {
        active = false;
      };
    }

    setHomeSubmissionsLoading(true);

    Promise.all(
      CHALLENGE_DAYS.map(day =>
        getGasJsonp('submission_status', {
          ...signedLaunchParams,
          challenge_date: day.value,
        }).catch(error => {
          console.warn(
            `Не удалось загрузить статус за ${day.value}:`,
            error
          );

          return null;
        })
      )
    )
      .then(results => {
        if (!active) {
          return;
        }

        const statuses = {};

        results.forEach((data, index) => {
          if (data?.ok && data.submitted && data.submission) {
            statuses[CHALLENGE_DAYS[index].value] = data.submission;
          }
        });

        setHomeSubmissions(statuses);
      })
      .finally(() => {
        if (active) {
          setHomeSubmissionsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    activeTab,
    hasSignedLaunchParams,
    isRegistered,
    userId,
    launchParams,
    moderationReloadKey,
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
     ЗАГРУЗКА ОЧЕРЕДИ МОДЕРАЦИИ
  ===================================== */

  useEffect(() => {
    let active = true;

    if (
      activeTab !== 'moderation' ||
      !isModerator ||
      !hasSignedLaunchParams
    ) {
      return () => {
        active = false;
      };
    }

    setModerationLoading(true);
    setModerationError('');
    setModerationMessage('');

    getModerationQueue(signedLaunchParams)
      .then(items => {
        if (active) {
          setModerationSubmissions(items);
        }
      })
      .catch(error => {
        if (active) {
          console.error(
            'Ошибка загрузки модерации:',
            error
          );

          setModerationError(
            ERROR_MESSAGES[error.message] ||
            error.message ||
            'Не удалось загрузить очередь модерации.'
          );
        }
      })
      .finally(() => {
        if (active) {
          setModerationLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    activeTab,
    isModerator,
    hasSignedLaunchParams,
    userId,
    launchParams,
  ]);

  /* =====================================
     РЕГИСТРАЦИЯ
  ===================================== */

  const openRegistrationForm = () => {
    if (!hasSignedLaunchParams) {
      setRegistrationMessage(
        'Для регистрации открой STEP CHALLENGE непосредственно через VK.'
      );

      setRegistrationMessageType('error');
      return;
    }

    if (isRegistered || registrationBusy || !registrationChecked) {
      return;
    }

    setRegistrationFirstName(current => current || first_name || '');
    setRegistrationLastName(current => current || last_name || '');
    setRegistrationMessage('');
    setRegistrationMessageType('');
    setRegistrationFormOpen(true);
  };

  const handleRegister = async event => {
    event?.preventDefault();

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

    const cleanFirstName = registrationFirstName.trim().replace(/\s+/g, ' ');
    const cleanLastName = registrationLastName.trim().replace(/\s+/g, ' ');
    const cleanGroup = registrationGroup.trim();

    if (!cleanFirstName || !cleanLastName || !cleanGroup) {
      setRegistrationMessage('Заполни имя, фамилию и номер группы.');
      setRegistrationMessageType('error');
      return;
    }

    if (cleanFirstName.length > 40 || cleanLastName.length > 40) {
      setRegistrationMessage('Имя и фамилия не должны быть длиннее 40 символов.');
      setRegistrationMessageType('error');
      return;
    }

    if (!/^\d{1,6}$/.test(cleanGroup)) {
      setRegistrationMessage('В поле «Группа» укажи только цифры (до 6 знаков).');
      setRegistrationMessageType('error');
      return;
    }

    setRegistrationBusy(true);
    setRegistrationMessage('');
    setRegistrationMessageType('');

    try {
      const registrationData = {
        action: 'register',
        ...signedLaunchParams,
        first_name: cleanFirstName,
        last_name: cleanLastName,
        group: cleanGroup,
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

      const participant = result.participant || {
        firstName: cleanFirstName,
        lastName: cleanLastName,
        group: cleanGroup,
      };

      setRegisteredParticipant(participant);
      setRegistrationFirstName(cleanFirstName);
      setRegistrationLastName(cleanLastName);
      setRegistrationGroup(cleanGroup);
      setIsRegistered(true);
      setRegistrationFormOpen(false);

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
     СКРИНШОТ
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

  const handleScreenshotChange = event => {
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

    // Проверку будущей даты убрали для тестирования.
    // Сервер всё равно разрешает только 23–27 ноября 2026.

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
      const jpegDataUrl = await convertImageToJpegDataUrl(
        screenshotFile
      );

      const originalBase64 = jpegDataUrl.split(',')[1] || '';

      // Base64URL: безопасно передаётся через HTML-форму.
      const base64 = originalBase64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

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
        mime_type: 'image/jpeg',
        image_base64: base64,
      });

      if (result.status === 'already_submitted') {
        setLastSubmission(result.submission || null);

      } else {
        setLastSubmission(
          result.submission || {
            steps,
            status: 'На проверке',
            submittedAt: new Date().toISOString(),
            comment: '',
          }
        );
      }

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

  /* =====================================
     МОДЕРАЦИЯ: ЗАГРУЗИТЬ СКРИНШОТ
  ===================================== */

  const handleLoadModerationImage = async submissionId => {
    if (moderationImages[submissionId]) {
      return;
    }

    setModerationImageLoading(previous => ({
      ...previous,
      [submissionId]: true,
    }));

    setModerationError('');

    try {
      const image = await getModerationImage(
        signedLaunchParams,
        submissionId
      );

      const dataUrl =
        `data:${image.mimeType};base64,${image.imageBase64}`;

      setModerationImages(previous => ({
        ...previous,
        [submissionId]: dataUrl,
      }));

    } catch (error) {
      console.error(
        'Ошибка загрузки скриншота:',
        error
      );

      setModerationError(
        ERROR_MESSAGES[error.message] ||
        error.message ||
        'Не удалось открыть изображение.'
      );

    } finally {
      setModerationImageLoading(previous => ({
        ...previous,
        [submissionId]: false,
      }));
    }
  };

  /* =====================================
     МОДЕРАЦИЯ: КОММЕНТАРИЙ
  ===================================== */

  const handleModerationCommentChange = (
    submissionId,
    value
  ) => {
    setModerationComments(previous => ({
      ...previous,
      [submissionId]: value,
    }));
  };

  /* =====================================
     МОДЕРАЦИЯ: РЕШЕНИЕ
  ===================================== */

  const handleModerationDecision = async (
    submission,
    decision
  ) => {
    if (!isModerator) {
      return;
    }

    const comment = String(
      moderationComments[submission.id] || ''
    ).trim();

    if (
      decision === 'Отклонено' &&
      !comment
    ) {
      setModerationMessage(
        'Напиши комментарий с причиной отклонения.'
      );

      return;
    }

    setModerationBusyId(submission.id);
    setModerationMessage('');
    setModerationError('');

    try {
      const result = await moderateSubmission({
        ...signedLaunchParams,
        submission_id: submission.id,
        decision,
        comment,
      });

      setModerationSubmissions(previous =>
        previous.filter(item => item.id !== submission.id)
      );

      setModerationMessage(
        result.message ||
        (
          decision === 'Одобрено'
            ? 'Результат одобрен.'
            : 'Результат отклонён.'
        )
      );

      // Удаляем сохранённый предпросмотр,
      // чтобы не хранить ненужные изображения в памяти.
      setModerationImages(previous => {
        const next = { ...previous };
        delete next[submission.id];
        return next;
      });

      setModerationComments(previous => {
        const next = { ...previous };
        delete next[submission.id];
        return next;
      });

      setModerationReloadKey(value => value + 1);

    } catch (error) {
      console.error(
        'Ошибка модерации:',
        error
      );

      setModerationError(
        ERROR_MESSAGES[error.message] ||
        error.message ||
        'Не удалось сохранить решение.'
      );

    } finally {
      setModerationBusyId('');
    }
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
            onClick={() => {
              if (registrationFormOpen) {
                setRegistrationFormOpen(false);
              } else {
                openRegistrationForm();
              }
            }}
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
              : !hasSignedLaunchParams
                ? 'Откройте через VK'
                : !registrationChecked
                  ? 'Проверяем...'
                  : registrationFormOpen
                    ? 'Свернуть форму'
                    : 'Участвовать'}

            <span>{isRegistered ? '✓' : '↗'}</span>
          </button>

          {registrationFormOpen && !isRegistered && (
            <div
              className="step-registration-card"
              style={{
                width: '100%',
                maxWidth: '390px',
                marginTop: '18px',
                padding: '17px',
                borderRadius: '18px',
                background: 'rgba(255,255,255,0.97)',
                color: '#18232d',
                textAlign: 'left',
                boxShadow: '0 14px 35px rgba(0,0,0,0.18)',
                boxSizing: 'border-box',
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '11px',
                paddingBottom: '13px',
                marginBottom: '14px',
                borderBottom: '1px solid #e8edf0',
              }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  flex: '0 0 42px',
                  overflow: 'hidden',
                  borderRadius: '50%',
                  background: '#e9eff2',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 800,
                  color: '#40515d',
                }}>
                  {photo_200 ? (
                    <img
                      src={photo_200}
                      alt=""
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    initials
                  )}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{
                    display: 'block',
                    fontSize: '13px',
                  }}>
                    Профиль ВКонтакте подключён
                  </strong>

                  <span style={{
                    display: 'block',
                    marginTop: '3px',
                    fontSize: '11px',
                    color: '#71808b',
                  }}>
                    Подтверждённый VK ID: {userId}
                  </span>
                </div>

                <span style={{
                  padding: '5px 8px',
                  borderRadius: '20px',
                  background: '#e7f7eb',
                  color: '#238044',
                  fontSize: '10px',
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                }}>
                  ✓ Подключён
                </span>
              </div>

              <h3 style={{
                margin: '0 0 5px',
                fontSize: '16px',
                fontWeight: 800,
              }}>
                Заполни данные участника
              </h3>

              <p style={{
                margin: '0 0 14px',
                fontSize: '11px',
                lineHeight: 1.45,
                color: '#71808b',
              }}>
                Имя и фамилия подставлены из профиля VK — проверь, если что-то не совпадает с твоими настоящими данными, то участие невозможно и не получиться узнать победителя.
              </p>

              <form onSubmit={handleRegister}>
                <label style={{
                  display: 'block',
                  marginBottom: '11px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#52616b',
                }}>
                  Имя

                  <input
                    type="text"
                    autoComplete="given-name"
                    value={registrationFirstName}
                    onChange={event =>
                      setRegistrationFirstName(event.target.value)
                    }
                    placeholder="Введите имя"
                    maxLength={40}
                    required
                    disabled={registrationBusy}
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '43px',
                      marginTop: '6px',
                      padding: '0 12px',
                      border: '1px solid #dce4e9',
                      borderRadius: '10px',
                      background: '#f8fafb',
                      color: '#18232d',
                      font: 'inherit',
                      fontSize: '13px',
                      outlineColor: '#8bbd4b',
                      boxSizing: 'border-box',
                    }}
                  />
                </label>

                <label style={{
                  display: 'block',
                  marginBottom: '11px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#52616b',
                }}>
                  Фамилия

                  <input
                    type="text"
                    autoComplete="family-name"
                    value={registrationLastName}
                    onChange={event =>
                      setRegistrationLastName(event.target.value)
                    }
                    placeholder="Введите фамилию"
                    maxLength={40}
                    required
                    disabled={registrationBusy}
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '43px',
                      marginTop: '6px',
                      padding: '0 12px',
                      border: '1px solid #dce4e9',
                      borderRadius: '10px',
                      background: '#f8fafb',
                      color: '#18232d',
                      font: 'inherit',
                      fontSize: '13px',
                      outlineColor: '#8bbd4b',
                      boxSizing: 'border-box',
                    }}
                  />
                </label>

                <label style={{
                  display: 'block',
                  marginBottom: '14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#52616b',
                }}>
                  Группа

                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{1,6}"
                    value={registrationGroup}
                    onChange={event =>
                      setRegistrationGroup(
                        event.target.value.replace(/\D/g, '').slice(0, 6)
                      )
                    }
                    placeholder="Например, 21"
                    maxLength={6}
                    required
                    disabled={registrationBusy}
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '43px',
                      marginTop: '6px',
                      padding: '0 12px',
                      border: '1px solid #dce4e9',
                      borderRadius: '10px',
                      background: '#f8fafb',
                      color: '#18232d',
                      font: 'inherit',
                      fontSize: '13px',
                      outlineColor: '#8bbd4b',
                      boxSizing: 'border-box',
                    }}
                  />

                  <span style={{
                    display: 'block',
                    marginTop: '4px',
                    fontSize: '10px',
                    fontWeight: 400,
                    color: '#89959d',
                  }}>
                    Укажи номер группы цифрами.
                  </span>
                </label>

                <button
                  type="submit"
                  className="step-primary-button"
                  disabled={registrationBusy}
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                  }}
                >
                  {registrationBusy
                    ? 'Регистрируем...'
                    : 'Зарегистрироваться'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRegistrationFormOpen(false);
                    setRegistrationMessage('');
                    setRegistrationMessageType('');
                  }}
                  disabled={registrationBusy}
                  style={{
                    width: '100%',
                    marginTop: '8px',
                    padding: '9px',
                    border: 0,
                    background: 'transparent',
                    color: '#78858d',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
              </form>
            </div>
          )}

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
              Ожидает результатов
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
              : formatNumber(participantsCount)}
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
          {CHALLENGE_DAYS.map(day => {
            const submission = homeSubmissions[day.value];

            return (
              <div className="step-day" key={day.value}>
                <div className="step-day-number">
                  {String(day.number).padStart(2, '0')}
                </div>

                <div className="step-day-info">
                  <strong>{day.label}</strong>
                  <span>Цель — 10 000 шагов</span>

                  {submission?.status === 'Отклонено' && submission.comment && (
                    <span style={{
                      display: 'block',
                      marginTop: '5px',
                      color: '#c34b43',
                      fontSize: '11px',
                      lineHeight: 1.4,
                    }}>
                      Причина: {submission.comment}
                    </span>
                  )}
                </div>

                <span className="step-day-status">
                  {homeSubmissionsLoading
                    ? 'Загрузка...'
                    : submission?.status || 'Не отправлено'}
                </span>
              </div>
            );
          })}
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
     СТРАНИЦА ОТПРАВКИ РЕЗУЛЬТАТА
  ===================================== */

  const renderSubmit = () => {
    const hasPendingOrApproved = Boolean(
      lastSubmission &&
      ['На проверке', 'Одобрено'].includes(lastSubmission.status)
    );

    const statusColor =
      lastSubmission?.status === 'Одобрено'
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
            Все изображения проверяются модератором.
            Дополнительные карточки активности автоматически
            не отклоняют заявку.
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
            setSubmissionMessageType('');
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
            <option
              key={day.value}
              value={day.value}
            >
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
          disabled={submissionBusy || hasPendingOrApproved}
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
          JPG, PNG или WEBP. Максимальный размер — 4 МБ.
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
              Отправлено шагов: {formatNumber(lastSubmission.steps)}
              {lastSubmission.submittedAt
                ? ` · ${formatDateTime(lastSubmission.submittedAt)}`
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
            hasPendingOrApproved
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
              : lastSubmission?.status === 'Отклонено'
                ? 'Отправить исправленный результат'
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
     СТРАНИЦА МОДЕРАЦИИ
  ===================================== */

  const renderModeration = () => (
    <section
      className="step-inner-page"
      style={{ paddingBottom: '30px' }}
    >
      <button
        type="button"
        onClick={() => setActiveTab('profile')}
        style={{
          border: 'none',
          background: 'transparent',
          padding: '8px 0',
          color: 'var(--vkui--color_text_link, #2678d8)',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        ← В профиль
      </button>

      <span className="step-overline">
        ПАНЕЛЬ АДМИНИСТРАТОРА
      </span>

      <h1>Модерация</h1>

      <p className="step-page-description">
        Проверяй скриншоты студентов, одобряй или отклоняй
        результаты и оставляй комментарии.
      </p>

      {moderationMessage && (
        <div style={{
          padding: '12px',
          margin: '14px 0',
          borderRadius: '12px',
          background: 'var(--vkui--color_background_secondary, #f3f4f5)',
          color: 'var(--vkui--color_text_primary, #222)',
          fontSize: '13px',
        }}>
          {moderationMessage}
        </div>
      )}

      {moderationError && (
        <div
          role="alert"
          style={{
            padding: '12px',
            margin: '14px 0',
            borderRadius: '12px',
            background: '#fff0ef',
            color: '#b43b32',
            fontSize: '13px',
          }}
        >
          {moderationError}
        </div>
      )}

      {moderationLoading ? (
        <div className="step-empty-card">
          <p>Загружаем заявки...</p>
        </div>
      ) : moderationSubmissions.length === 0 ? (
        <div className="step-empty-card">
          <div className="step-empty-icon">✓</div>

          <h2>Очередь пуста</h2>

          <p>
            Сейчас нет заявок, ожидающих проверки.
          </p>

          <button
            type="button"
            onClick={() => setModerationReloadKey(value => value + 1)}
            style={{
              marginTop: '12px',
              padding: '10px 16px',
              border: '1px solid var(--vkui--color_separator_primary, #ddd)',
              borderRadius: '10px',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Обновить
          </button>
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            margin: '18px 0 12px',
          }}>
            <strong>
              Ожидают проверки: {moderationSubmissions.length}
            </strong>

            <button
              type="button"
              onClick={() => setModerationReloadKey(value => value + 1)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--vkui--color_text_link, #2678d8)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Обновить
            </button>
          </div>

          {moderationSubmissions.map(submission => {
            const image = moderationImages[submission.id];

            const imageLoading =
              Boolean(moderationImageLoading[submission.id]);

            const busy =
              moderationBusyId === submission.id;

            return (
              <article
                key={submission.id}
                style={{
                  padding: '15px',
                  marginBottom: '15px',
                  borderRadius: '16px',
                  border: '1px solid var(--vkui--color_separator_primary, #ddd)',
                  background: 'var(--vkui--color_background_content, #fff)',
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '10px',
                  alignItems: 'flex-start',
                }}>
                  <div>
                    <strong style={{
                      display: 'block',
                      fontSize: '16px',
                    }}>
                      {submission.participant || 'Участник'}
                    </strong>

                    <span style={{
                      display: 'block',
                      marginTop: '4px',
                      fontSize: '12px',
                      opacity: 0.65,
                    }}>
                      VK ID: {submission.vkUserId}
                    </span>
                  </div>

                  <span style={{
                    padding: '5px 8px',
                    borderRadius: '8px',
                    background: '#fff4d7',
                    color: '#946b13',
                    fontSize: '11px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}>
                    На проверке
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '10px',
                  marginTop: '14px',
                  fontSize: '13px',
                }}>
                  <div>
                    <span style={{ opacity: 0.6 }}>
                      Дата результата
                    </span>

                    <strong style={{
                      display: 'block',
                      marginTop: '3px',
                    }}>
                      {submission.date}
                    </strong>
                  </div>

                  <div>
                    <span style={{ opacity: 0.6 }}>
                      Количество шагов
                    </span>

                    <strong style={{
                      display: 'block',
                      marginTop: '3px',
                    }}>
                      {formatNumber(submission.steps)}
                    </strong>
                  </div>

                  <div>
                    <span style={{ opacity: 0.6 }}>
                      Время телефона
                    </span>

                    <strong style={{
                      display: 'block',
                      marginTop: '3px',
                    }}>
                      {submission.phoneTime || 'Не указано'}
                    </strong>
                  </div>

                  <div>
                    <span style={{ opacity: 0.6 }}>
                      Получено сервером
                    </span>

                    <strong style={{
                      display: 'block',
                      marginTop: '3px',
                    }}>
                      {formatDateTime(submission.submittedAt)}
                    </strong>
                  </div>
                </div>

                {!image && (
                  <button
                    type="button"
                    disabled={imageLoading}
                    onClick={() => handleLoadModerationImage(submission.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      marginTop: '15px',
                      padding: '12px',
                      border: '1px solid var(--vkui--color_separator_primary, #ddd)',
                      borderRadius: '10px',
                      background: 'var(--vkui--color_background_secondary, #f3f4f5)',
                      color: 'var(--vkui--color_text_primary, #222)',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {imageLoading
                      ? 'Загружаем изображение...'
                      : 'Показать скриншот'}
                  </button>
                )}

                {image && (
                  <div style={{
                    marginTop: '14px',
                  }}>
                    <img
                      src={image}
                      alt={`Скриншот ${submission.participant}`}
                      style={{
                        display: 'block',
                        width: '100%',
                        maxHeight: '600px',
                        objectFit: 'contain',
                        borderRadius: '10px',
                        background: '#eee',
                      }}
                    />
                  </div>
                )}

                <label
                  htmlFor={`moderation-comment-${submission.id}`}
                  style={{
                    display: 'block',
                    margin: '16px 0 7px',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  Комментарий модератора
                </label>

                <textarea
                  id={`moderation-comment-${submission.id}`}
                  value={moderationComments[submission.id] || ''}
                  onChange={event =>
                    handleModerationCommentChange(
                      submission.id,
                      event.target.value
                    )
                  }
                  placeholder="Например: дата на скриншоте не совпадает..."
                  rows={3}
                  maxLength={1000}
                  disabled={busy}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '11px',
                    borderRadius: '10px',
                    border: '1px solid var(--vkui--color_field_border, #c8c8c8)',
                    background: 'var(--vkui--color_field_background, #fff)',
                    color: 'var(--vkui--color_text_primary, #222)',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    fontSize: '13px',
                  }}
                />

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '9px',
                  marginTop: '12px',
                }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      handleModerationDecision(
                        submission,
                        'Одобрено'
                      )
                    }
                    style={{
                      padding: '12px 8px',
                      border: 'none',
                      borderRadius: '10px',
                      background: '#dff5e5',
                      color: '#176b32',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {busy ? 'Сохраняем...' : '✓ Одобрить'}
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      handleModerationDecision(
                        submission,
                        'Отклонено'
                      )
                    }
                    style={{
                      padding: '12px 8px',
                      border: 'none',
                      borderRadius: '10px',
                      background: '#ffe7e5',
                      color: '#b43b32',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {busy ? 'Сохраняем...' : '✕ Отклонить'}
                  </button>
                </div>

                <p style={{
                  margin: '9px 0 0',
                  fontSize: '11px',
                  opacity: 0.6,
                  lineHeight: 1.4,
                }}>
                  При отклонении необходимо указать причину в комментарии.
                </p>
              </article>
            );
          })}
        </>
      )}
    </section>
  );

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
                  {formatNumber(item.steps)} шагов
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

        {(registeredParticipant?.group || registrationGroup) && (
          <p>Группа {registeredParticipant?.group || registrationGroup}</p>
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

      {isModerator && (
        <div style={{
          marginTop: '18px',
          padding: '15px',
          borderRadius: '15px',
          border: '1px solid var(--vkui--color_separator_primary, #ddd)',
        }}>
          <span className="step-overline">
            ADMIN PANEL
          </span>

          <h2 style={{
            margin: '5px 0 12px',
          }}>
            Панель модератора
          </h2>

          <p style={{
            fontSize: '13px',
            lineHeight: 1.5,
            opacity: 0.7,
          }}>
            Проверяй скриншоты участников и управляй результатами челленджа.
          </p>

          <button
            type="button"
            className="step-primary-button"
            onClick={() => {
              setActiveTab('moderation');
              setModerationMessage('');
              setModerationError('');
            }}
            style={{
              width: '100%',
              marginTop: '10px',
            }}
          >
            Модерация
            <span>↗</span>
          </button>
        </div>
      )}
    </section>
  );

  /* =====================================
     ЭКРАН ЗАГРУЗКИ ПРОФИЛЯ VK
  ===================================== */

  if (profileLoading || !registrationChecked) {
    return (
      <Panel
        id={id}
        className="step-panel"
      >
        <PanelHeader>STEP CHALLENGE</PanelHeader>

        <style>
          {`
            @keyframes stepLoaderSpin {
              to {
                transform: rotate(360deg);
              }
            }
            @keyframes stepLoaderPulse {
              0%, 100% {
                opacity: 0.45;
                transform: scale(0.96);
              }
              50% {
                opacity: 1;
                transform: scale(1);
              }
            }
            @keyframes stepLoaderFade {
              from {
                opacity: 0;
                transform: translateY(8px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
          `}
        </style>

        <div style={{
          minHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          boxSizing: 'border-box',
          textAlign: 'center',
          animation: 'stepLoaderFade 0.5s ease both',
        }}>
          <div style={{
            width: '78px',
            height: '78px',
            borderRadius: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#c8f36d',
            color: '#18251d',
            fontSize: '38px',
            fontWeight: 900,
            boxShadow: '0 12px 40px rgba(150, 190, 70, 0.2)',
            animation: 'stepLoaderPulse 1.8s ease-in-out infinite',
          }}>
            S
          </div>

          <div style={{
            width: '30px',
            height: '30px',
            marginTop: '30px',
            border: '3px solid rgba(120, 140, 100, 0.18)',
            borderTopColor: '#8bbd3c',
            borderRadius: '50%',
            animation: 'stepLoaderSpin 0.8s linear infinite',
          }} />

          <h2 style={{
            margin: '22px 0 7px',
            fontSize: '21px',
            fontWeight: 800,
          }}>
            STEP CHALLENGE
          </h2>

          <p style={{
            margin: 0,
            fontSize: '13px',
            opacity: 0.65,
          }}>
            Загружаем твой профиль VK...
          </p>
        </div>
      </Panel>
    );
  }

  /* =====================================
     ОСНОВНОЙ ИНТЕРФЕЙС
  ===================================== */

  return (
    <Panel
      id={id}
      className="step-panel"
    >
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
              <strong>{displayFirstName || 'участник'}</strong>
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

        {activeTab === 'moderation' && (
          isModerator
            ? renderModeration()
            : renderProfile()
        )}

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
            className={
              activeTab === 'profile' ||
              activeTab === 'moderation'
                ? 'active'
                : ''
            }
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