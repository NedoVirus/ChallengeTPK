import { useState, useEffect } from 'react';
import bridge from '@vkontakte/vk-bridge';

import {
  View,
  SplitLayout,
  SplitCol,
} from '@vkontakte/vkui';

import { useActiveVkuiLocation } from '@vkontakte/vk-mini-apps-router';

import { Home } from './panels';
import { DEFAULT_VIEW_PANELS } from './routes';
import { SensorTest } from './SensorTest';

export const App = () => {
  const {
    panel: activePanel = DEFAULT_VIEW_PANELS.HOME,
  } = useActiveVkuiLocation();

  const [fetchedUser, setUser] = useState(null);
  const [launchParams, setLaunchParams] = useState(null);

  const isSensorTest =
    new URLSearchParams(window.location.search)
      .get('sensor-test') === '1';

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const user = await bridge.send('VKWebAppGetUserInfo');

        if (!cancelled) {
          setUser(user);
        }
      } catch (error) {
        console.warn(
          'Не удалось получить профиль VK:',
          error
        );
      }

      try {
        const urlParams = Object.fromEntries(
          new URLSearchParams(
            window.location.search
          ).entries()
        );

        let params = urlParams;

        if (
          !params.vk_user_id ||
          !params.vk_app_id ||
          !params.sign
        ) {
          params = await bridge.send(
            'VKWebAppGetLaunchParams'
          );
        }

        if (!cancelled) {
          setLaunchParams(params);
        }
      } catch (error) {
        console.warn(
          'Не удалось получить параметры запуска VK:',
          error
        );
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isSensorTest) {
    return <SensorTest />;
  }

  return (
    <SplitLayout>
      <SplitCol>
        <View activePanel={activePanel}>
          <Home
            id="home"
            fetchedUser={fetchedUser}
            launchParams={launchParams}
          />
        </View>
      </SplitCol>
    </SplitLayout>
  );
};