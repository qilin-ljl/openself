import { getTranslations } from 'next-intl/server';
import { Brand } from '../../../components/brand';
import { LanguageSwitch } from '../../../components/language-switch';
export default async function Privacy() {
  const t = await getTranslations('privacy');
  return (
    <div className="landing">
      <header className="site-header">
        <Brand />
        <LanguageSwitch />
      </header>
      <main className="app-main">
        <div className="page-heading">
          <div>
            <h1>{t('title')}</h1>
            <p>{t('intro')}</p>
          </div>
        </div>
        <div className="markdown-body">
          {['account', 'code', 'ai', 'retention', 'extension', 'control'].map((k) => (
            <section key={k}>
              <h2>{t(k + 'Title')}</h2>
              <p>{t(k + 'Body')}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
