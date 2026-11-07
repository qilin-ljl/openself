import { getTranslations } from 'next-intl/server';
import { Preferences } from '../../../../components/preferences';
import { AISettings } from '../../../../components/ai-settings';
import { AccountAction } from '../../../../components/account-action';
export default async function Settings() {
  const t = await getTranslations('settings');
  return (
    <div className="settings-panel">
      <div className="page-heading">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
      </div>
      <section className="settings-row">
        <div>
          <h2>{t('publicationScope')}</h2>
          <p>{t('publicationScopeDescription')}</p>
        </div>
      </section>
      <Preferences />
      <AISettings />
      <section className="settings-row">
        <div>
          <h2>{t('revoke')}</h2>
          <p>{t('revokeDescription')}</p>
        </div>
        <AccountAction action="revoke" />
      </section>
    </div>
  );
}
