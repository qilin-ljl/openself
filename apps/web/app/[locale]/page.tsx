import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  ArrowDown,
  ArrowRight,
  Check,
  GitPullRequest,
  MessageSquare,
  FileText,
  GitBranch,
} from 'lucide-react';
import { Button } from '@openself/ui/button';
import { Brand } from '../../components/brand';
import { LanguageSwitch } from '../../components/language-switch';
export default async function Home({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('landing');
  const c = await getTranslations('common');
  const { error } = await searchParams;
  const login = `/api/auth/github/login?next=/${locale}/dashboard`;
  return (
    <main className="landing">
      <header className="site-header">
        <Brand />
        <div className="header-actions">
          <LanguageSwitch />
          <Button asChild variant="outline">
            <a href={login}>
              {c('github')}
              <ArrowRight size={16} />
            </a>
          </Button>
        </div>
      </header>
      {error && (
        <div className="auth-error" role="alert">
          <strong>{t('errorTitle')}</strong>
          <p>{t('errorDescription')}</p>
        </div>
      )}
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="signal-dot" />
            {t('eyebrow')}
          </div>
          <h1>{t('title')}</h1>
          <p className="hero-description">{t('description')}</p>
          <div className="hero-actions">
            <Button asChild>
              <a href={login}>
                <GitBranch size={19} />
                {c('github')}
                <ArrowRight size={18} />
              </a>
            </Button>
            <a className="text-link" href="#workflow">
              {t('secondary')}
              <ArrowDown size={16} />
            </a>
          </div>
          <p className="approval-note">
            <Check size={14} />
            {t('note')}
          </p>
        </div>
        <div className="flow-diagram" aria-label={t('flowCaption')}>
          <div className="flow-caption">{t('flowCaption')}</div>
          <div className="flow-node">
            <GitBranch />
            <span>{t('flowInput')}</span>
          </div>
          <div className="flow-line" />
          <div className="flow-node">
            <FileText />
            <span>{t('flowDraft')}</span>
          </div>
          <div className="flow-line" />
          <div className="flow-node decision">
            <Check />
            <span>{t('flowDecision')}</span>
          </div>
          <div className="flow-line" />
          <div className="flow-output">
            {t('flowPublish')}
            <ArrowRight size={18} />
          </div>
        </div>
      </section>
      <section className="workflow" id="workflow">
        <div className="section-heading">
          <h2>{t('workflow')}</h2>
          <p>{t('workflowDescription')}</p>
        </div>
        <div className="workflow-grid">
          {[
            {
              number: '01',
              icon: MessageSquare,
              title: 'issueTitle',
              description: 'issueDescription',
              steps: 'issueSteps',
            },
            {
              number: '02',
              icon: GitPullRequest,
              title: 'reviewTitle',
              description: 'reviewDescription',
              steps: 'reviewSteps',
            },
          ].map((item) => (
            <article key={item.number} className="workflow-card">
              <div className="card-top">
                <span className="folio">{item.number}</span>
                <item.icon size={27} />
              </div>
              <h3>{t(item.title)}</h3>
              <p>{t(item.description)}</p>
              <div className="workflow-steps">
                {t(item.steps)}
                <ArrowRight size={18} />
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="control">
        <h2>{t('controlTitle')}</h2>
        <div>
          <p>{t('controlDescription')}</p>
          <div className="build-status">
            <span className="signal-dot" />
            <strong>{t('status')}</strong>
          </div>
          <p className="status-description">{t('statusDescription')}</p>
        </div>
      </section>
      <footer className="site-footer">
        <span>{c('brand')}</span>
        <span>{t('footer')}</span>
        <span>{c('version')}</span>
      </footer>
    </main>
  );
}
