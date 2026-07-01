import { CircleHelp, Moon, Sun, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export type Logo = {
  name: string;
  src: string;
  file: string;
  width: number | null;
  height: number | null;
};

type LogoRegistryProps = {
  logos: Logo[];
};

type ThemeMode = 'light' | 'dark';
type CopyStatus = 'idle' | 'copied' | 'failed';

const CONTACT_EMAIL = 'contest@hydro.ac';
const THEME_STORAGE_KEY = 'hydro-logo-registry-theme';

const problems = [
  ['A', 'accepted'],
  ['B', 'accepted'],
  ['C', 'failed'],
  ['D', 'pending'],
  ['E', 'accepted'],
  ['F', 'pending'],
] as const;

const normalize = (value: string) => value.trim().toLocaleLowerCase('zh-CN');

const hasLowLogoResolution = (logo: Logo) => {
  if (!logo.width || !logo.height) return false;
  return logo.width < 512 || logo.height < 512;
};

const formatLogoSize = (logo: Logo) => {
  if (!logo.width || !logo.height) return '未知尺寸';
  return `${logo.width} x ${logo.height}`;
};

function LogoSample({ logo, dark = false }: { logo: Logo; dark?: boolean }) {
  return (
    <section className={`preview-panel ${dark ? 'preview-black' : 'preview-white'}`} aria-label={dark ? '黑底效果' : '白底效果'}>
      <h3>{dark ? '黑底' : '白底'}</h3>
      <div className="preview-canvas">
        <div className="logo-sample">
          <img className="detail-logo" src={logo.src} alt={`${logo.name} logo`} />
          <span className="sample-team-name">这里是一个队名</span>
        </div>
      </div>
    </section>
  );
}

function ScoreboardCard({ logo, dark = false }: { logo: Logo; dark?: boolean }) {
  return (
    <div className={`scoreboard-card ${dark ? 'scoreboard-dark' : 'scoreboard-light'}`} aria-label={dark ? '深色 scoreboard 效果' : '浅色 scoreboard 效果'}>
      <div className="scoreboard-head" aria-hidden="true">
        <span>Rank</span>
        <span>Team</span>
        <span>Solved</span>
        <span>Penalty</span>
      </div>
      <div className="scoreboard-row">
        <span className="rank-cell">12</span>
        <span className="team-cell">
          <img className="scoreboard-logo" src={logo.src} alt={`${logo.name} logo`} />
          <span className="team-copy">
            <strong>{logo.name} - 这里是一个队名</strong>
            <span className="problem-strip" aria-label="通过题目">
              {problems.map(([label, status]) => (
                <span className={status} key={label}>
                  {label}
                </span>
              ))}
            </span>
          </span>
        </span>
        <span className="score-cell">6</span>
        <span className="penalty-cell">742</span>
      </div>
    </div>
  );
}

export default function LogoRegistry({ logos }: LogoRegistryProps) {
  const [query, setQuery] = useState('');
  const [selectedLogo, setSelectedLogo] = useState<Logo | null>(null);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [isUploadInfoOpen, setIsUploadInfoOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uploadDialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const visibleLogos = useMemo(() => {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return logos;
    return logos.filter((logo) => {
      const name = normalize(logo.name);
      const file = normalize(logo.file);
      return name.includes(normalizedQuery) || file.includes(normalizedQuery);
    });
  }, [logos, query]);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === 'light' || savedTheme === 'dark') {
        setTheme(savedTheme);
        return;
      }
    } catch {
      // Ignore storage access failures and fall back to the system preference.
    }

    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage is optional; the visual theme still applies for this session.
    }
  }, [theme]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (selectedLogo) {
      if (!dialog.open) dialog.showModal();
      return;
    }

    if (dialog.open) dialog.close();
  }, [selectedLogo]);

  useEffect(() => {
    const dialog = uploadDialogRef.current;
    if (!dialog) return;

    if (isUploadInfoOpen) {
      if (!dialog.open) dialog.showModal();
      return;
    }

    if (dialog.open) dialog.close();
  }, [isUploadInfoOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== '/') return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  function closeDetail() {
    setSelectedLogo(null);
  }

  function openUploadInfo() {
    setCopyStatus('idle');
    setIsUploadInfoOpen(true);
  }

  function closeUploadInfo() {
    setIsUploadInfoOpen(false);
  }

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }

  async function copyEmailAddress() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  return (
    <>
      <main className="app-shell">
        <header className="app-header">
          <div className="title-block">
            <p className="eyebrow">Hydro Contest Team</p>
            <h1>School Logo Registry</h1>
          </div>

          <div className="toolbar" role="search">
            <label className="search-control">
              <span className="search-label">Search</span>
              <input
                ref={searchInputRef}
                id="logo-search"
                type="search"
                value={query}
                placeholder="搜索学校 logo"
                autoComplete="off"
                aria-label="搜索学校 logo"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <div className="toolbar-side">
              <output id="logo-count" className="logo-count" htmlFor="logo-search">
                {visibleLogos.length} logos
              </output>
              <div className="toolbar-actions">
                <button
                  className="upload-info-button"
                  type="button"
                  aria-label="上传新logo"
                  data-tooltip="上传新logo"
                  onClick={openUploadInfo}
                >
                  <Upload className="theme-icon" aria-hidden="true" />
                </button>
                <button
                  className="theme-toggle"
                  type="button"
                  aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                  aria-pressed={theme === 'dark'}
                  onClick={toggleTheme}
                >
                  {theme === 'dark' ? <Sun className="theme-icon" aria-hidden="true" /> : <Moon className="theme-icon" aria-hidden="true" />}
                </button>
                <a
                  className="help-link"
                  href="https://contest.hydro.ac"
                  aria-label="了解 Hydro Contest Team"
                  data-tooltip="了解 Hydro Contest Team"
                >
                  <CircleHelp className="theme-icon" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </header>

        <section className="logo-grid" id="logo-grid" aria-label="School logos">
          {visibleLogos.map((logo) => (
            <button
              className="logo-card"
              type="button"
              key={logo.file}
              aria-label={`查看 ${logo.name} logo`}
              onClick={() => setSelectedLogo(logo)}
            >
              <span className="logo-stage">
                <img src={logo.src} alt="" loading="lazy" decoding="async" />
              </span>
              <span className="logo-name">{logo.name}</span>
            </button>
          ))}
        </section>

        {visibleLogos.length === 0 && (
          <div className="empty-state">
            <button className="empty-upload-button" type="button" onClick={openUploadInfo}>
              没有 logo？点我上传新 logo
            </button>
          </div>
        )}
      </main>

      <dialog
        ref={dialogRef}
        className="detail-dialog"
        aria-labelledby="detail-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDetail();
        }}
        onClose={closeDetail}
      >
        {selectedLogo && (
          <div className="detail-shell">
            <header className="detail-header">
              <div className="detail-title-block">
                <p className="eyebrow">Logo Detail</p>
                <h2 id="detail-title">{selectedLogo.name}</h2>
                <p className="detail-file">{selectedLogo.file}</p>
                {hasLowLogoResolution(selectedLogo) && (
                  <button className="logo-quality-warning" type="button" onClick={openUploadInfo}>
                    当前 logo 尺寸 {formatLogoSize(selectedLogo)} 不够清晰，技术组建议上传新 logo。
                  </button>
                )}
                <button className="inline-upload-link" type="button" onClick={openUploadInfo}>
                  logo 不对？点我上传新 logo
                </button>
              </div>
              <div className="detail-actions">
                <button
                  className="upload-info-button detail-upload-button"
                  type="button"
                  aria-label="上传新logo"
                  data-tooltip="上传新logo"
                  onClick={openUploadInfo}
                >
                  <Upload className="theme-icon" aria-hidden="true" />
                </button>
                <button className="close-button" type="button" aria-label="关闭详情" onClick={closeDetail}>
                  &times;
                </button>
              </div>
            </header>

            <div className="preview-grid">
              <LogoSample logo={selectedLogo} />
              <LogoSample logo={selectedLogo} dark />

              <section className="preview-panel scoreboard-panel" aria-label="Scoreboard 效果">
                <h3>Scoreboard</h3>
                <div className="scoreboard-stack">
                  <ScoreboardCard logo={selectedLogo} />
                  <ScoreboardCard logo={selectedLogo} dark />
                </div>
              </section>
            </div>
          </div>
        )}
      </dialog>

      <dialog
        ref={uploadDialogRef}
        className="upload-dialog"
        aria-labelledby="upload-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeUploadInfo();
        }}
        onClose={closeUploadInfo}
      >
        <div className="upload-shell">
          <header className="upload-header">
            <div className="detail-title-block">
              <p className="eyebrow">Logo Upload</p>
              <h2 id="upload-title">上传或更新校徽</h2>
            </div>
            <button className="close-button" type="button" aria-label="关闭上传说明" onClick={closeUploadInfo}>
              &times;
            </button>
          </header>

          <div className="upload-content">
            <p>Hydro 赛事技术组受 ICPC 总部委托，同时还在进行校徽的收集，技术组对校徽的统一要求如下：</p>
            <p className="identity-note">请使用学校邮箱给我们发消息以验证身份，否则不做处理。</p>

            <ul>
              <li>如果是 svg，只需提供 svg 即可，技术组会处理为合乎标准的格式；</li>
              <li>
                如果是 png，则：
                <ol type="a">
                  <li>尺寸必须为 512 像素 x 512 像素；</li>
                  <li>背景必须为透明底色，不可使用纯色背景；</li>
                  <li>如果内部有镂空，则必须用白色填充；</li>
                  <li>如果 logo 配有深色文字，则文字部分应当有白边描边。</li>
                </ol>
              </li>
            </ul>

            <p>附加说明：</p>

            <ol type="a">
              <li>技术组建议优先上传 svg。对于 ai 等其他矢量格式，请自行转换。</li>
              <li>
                对于 jpg 等格式请勿上传。不符合以上要求的校徽技术组不保证能够正常更新信息库，也不保证届时在比赛各场合的显示效果（例如可能出现：比赛需要显示校徽的地方无法正确显示校徽，或显示错误等）。
              </li>
              <li>为保证数据一致性及不影响工作效率，错误的校徽在截止日期后只能等待下一年更新时修改，EC 委员会、比赛主办方等均无法修改。</li>
              <li>
                数据将以上传的内容为准，如校徽不正确、比例异常、有水印、图片质量过差等情况，将被视作学校行为，技术组将充分尊重意愿，以原始数据使用贵校的校徽。
              </li>
              <li>根据实际情况，技术组建议学校优先提供彩色而非黑白校徽（因黑白校徽使用场景会受到很大的制约）。</li>
            </ol>

            <p>收集到的校徽将被使用在以下的地方（不完整）：</p>

            <ul>
              <li>ICPC 总部的所有相关系统（包括网站及其他可能使用的部分）；</li>
              <li>PINTIA 报名系统，将被使用在团体程序设计天梯赛、XCPC 比赛等所有 PINTIA 系统举办的活动中；</li>
              <li>由 Hydro 赛事技术组负责技术工作的比赛的全流程中，包括：比赛开始前机器上显示的校徽、榜单上的校徽、直播时的信息条、滚榜时的信息条。</li>
              <li>EC ICPC 的相关活动中（包含宣传中）；</li>
              <li>EC ICPC 区域赛的物料中（我们将会将校徽库分享给所有 EC ICPC 的 RCDs）；</li>
              <li>其他总部、EC 总部、技术组认为有必要使用的场景。</li>
            </ul>

            <p>如愿意，请发送邮件提交合乎要求的校徽。</p>
          </div>

          <footer className="upload-footer">
            <a className="mail-action primary" href={`mailto:${CONTACT_EMAIL}`}>
              发邮件
            </a>
            <button className="mail-action" type="button" onClick={copyEmailAddress}>
              复制邮件地址
            </button>
            <span className={`copy-status ${copyStatus}`} aria-live="polite">
              {copyStatus === 'copied' ? `已复制 ${CONTACT_EMAIL}` : copyStatus === 'failed' ? `请手动复制 ${CONTACT_EMAIL}` : CONTACT_EMAIL}
            </span>
          </footer>
        </div>
      </dialog>

      <style>{registryStyles}</style>
    </>
  );
}

const registryStyles = `
:root {
  color-scheme: light;
  --bg: #f4f7fb;
  --surface: #ffffff;
  --surface-muted: #e8eef7;
  --text: #111827;
  --muted: #64748b;
  --line: #d7e0ee;
  --accent: #2563eb;
  --accent-strong: #1d4ed8;
  --accent-soft: #e8f0ff;
  --accent-line: #bfd2ff;
  --accepted: #14834f;
  --warning: #b36b00;
  --danger: #b13434;
  --pending: #8a93a3;
  --header-bg: rgba(244, 247, 251, 0.92);
  --header-line: rgba(215, 224, 238, 0.9);
  --hero-fade: #ffffff;
  --focus-ring: rgba(37, 99, 235, 0.18);
  --card-shadow: 0 4px 16px rgba(17, 24, 39, 0.05);
  --card-shadow-hover: 0 12px 26px rgba(37, 99, 235, 0.14);
  --checker-cell: rgba(15, 23, 42, 0.045);
  --logo-stage-bg: #fbfdff;
  --logo-stage-border: #e6edf8;
  --backdrop: rgba(15, 23, 42, 0.58);
  --score-accent-dark: #86b7ff;
  --shadow: 0 18px 44px rgba(17, 24, 39, 0.16);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif;
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #101114;
  --surface: #181a20;
  --surface-muted: #242832;
  --text: #f3f6fb;
  --muted: #a7b0c0;
  --line: #333947;
  --accent: #5b9cff;
  --accent-strong: #8bbcff;
  --accent-soft: rgba(91, 156, 255, 0.18);
  --accent-line: rgba(139, 188, 255, 0.38);
  --accepted: #2aa36c;
  --warning: #f2b85e;
  --danger: #e05252;
  --pending: #7d8594;
  --header-bg: rgba(16, 17, 20, 0.9);
  --header-line: rgba(51, 57, 71, 0.9);
  --hero-fade: #17191e;
  --focus-ring: rgba(91, 156, 255, 0.24);
  --card-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  --card-shadow-hover: 0 14px 30px rgba(0, 0, 0, 0.34);
  --checker-cell: rgba(255, 255, 255, 0.07);
  --logo-stage-bg: #111827;
  --logo-stage-border: #30384a;
  --backdrop: rgba(0, 0, 0, 0.68);
  --shadow: 0 18px 44px rgba(0, 0, 0, 0.4);
}

* {
  box-sizing: border-box;
}

body {
  min-width: 320px;
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

button,
input {
  font: inherit;
}

.app-shell {
  width: min(1520px, calc(100% - 32px));
  margin: 0 auto;
  padding: 24px 0 56px;
}

.app-header {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(420px, 720px);
  gap: 20px;
  align-items: end;
  padding: 18px 0;
}

.title-block,
.detail-title-block {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 5px;
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  overflow-wrap: anywhere;
}

h1 {
  margin: 0;
  font-size: clamp(28px, 5vw, 58px);
  line-height: 0.98;
  letter-spacing: 0;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.toolbar-side {
  display: grid;
  gap: 7px;
  justify-items: end;
  min-width: 0;
}

.search-control {
  display: grid;
  gap: 6px;
}

.search-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

#logo-search {
  width: 100%;
  min-height: 44px;
  padding: 0 14px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  outline: none;
}

#logo-search:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.logo-count {
  color: var(--muted);
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
}

.upload-info-button,
.theme-toggle,
.help-link,
.mail-action {
  min-height: 44px;
  padding: 0 14px;
  color: var(--accent-strong);
  background: var(--surface);
  border: 1px solid var(--accent-line);
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.2;
  text-decoration: none;
}

.upload-info-button,
.theme-toggle,
.help-link {
  display: grid;
  place-items: center;
  width: 44px;
  padding: 0;
}

.upload-info-button,
.help-link {
  position: relative;
}

.upload-info-button::after,
.help-link::after {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  width: max-content;
  max-width: min(240px, calc(100vw - 24px));
  padding: 7px 10px;
  color: #ffffff;
  background: #111827;
  border-radius: 6px;
  content: attr(data-tooltip);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition:
    opacity 140ms ease,
    transform 140ms ease;
  white-space: nowrap;
}

.upload-info-button:hover::after,
.upload-info-button:focus-visible::after,
.help-link:hover::after,
.help-link:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

.theme-icon {
  width: 20px;
  height: 20px;
  stroke-width: 2.2;
}

.upload-info-button:hover,
.upload-info-button:focus-visible,
.theme-toggle:hover,
.theme-toggle:focus-visible,
.help-link:hover,
.help-link:focus-visible,
.mail-action:hover,
.mail-action:focus-visible {
  color: var(--accent-strong);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
  outline: none;
}

.mail-action.primary {
  display: inline-grid;
  place-items: center;
  color: #ffffff;
  background: var(--accent);
  border-color: var(--accent);
}

.logo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 12px;
  padding-top: 18px;
}

.logo-card {
  display: grid;
  grid-template-rows: minmax(112px, 1fr) 44px;
  gap: 10px;
  min-height: 176px;
  padding: 12px;
  color: var(--text);
  text-align: center;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: pointer;
  box-shadow: var(--card-shadow);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.logo-card:hover,
.logo-card:focus-visible {
  border-color: var(--accent-line);
  box-shadow: var(--card-shadow-hover);
  transform: translateY(-2px);
  outline: none;
}

.logo-stage {
  display: grid;
  place-items: center;
  min-width: 0;
  aspect-ratio: 1;
  padding: 14px;
  background:
    linear-gradient(45deg, var(--checker-cell) 25%, transparent 25%),
    linear-gradient(-45deg, var(--checker-cell) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--checker-cell) 75%),
    linear-gradient(-45deg, transparent 75%, var(--checker-cell) 75%),
    var(--logo-stage-bg);
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
  border: 1px solid var(--logo-stage-border);
  border-radius: 8px;
}

.logo-stage img,
.scoreboard-logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.logo-name {
  display: -webkit-box;
  min-width: 0;
  min-height: 40px;
  overflow: hidden;
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.empty-state {
  margin: 48px 0 0;
  padding: 36px;
  text-align: center;
  background: transparent;
  border: 1px dashed var(--line);
  border-radius: 8px;
}

.empty-upload-button,
.inline-upload-link {
  padding: 0;
  color: var(--accent-strong);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-weight: 800;
  text-align: inherit;
}

.empty-upload-button {
  font-size: 18px;
}

.inline-upload-link {
  margin-top: 8px;
  font-size: 14px;
}

.empty-upload-button:hover,
.empty-upload-button:focus-visible,
.inline-upload-link:hover,
.inline-upload-link:focus-visible {
  color: var(--accent);
  text-decoration: underline;
  outline: none;
}

.detail-dialog,
.upload-dialog {
  width: min(1040px, calc(100dvw - 20px));
  max-width: calc(100dvw - 20px);
  max-height: calc(100dvh - 20px);
  margin: auto;
  padding: 0;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.upload-dialog {
  width: min(1120px, calc(100dvw - 32px));
  height: min(760px, calc(100dvh - 64px));
  max-height: calc(100dvh - 64px);
}

.detail-dialog::backdrop,
.upload-dialog::backdrop {
  background: var(--backdrop);
  backdrop-filter: blur(4px);
}

.detail-shell {
  display: grid;
  gap: clamp(12px, 2vw, 18px);
  max-height: calc(100dvh - 20px);
  padding: clamp(12px, 2.4vw, 22px);
  overflow: auto;
  overscroll-behavior: contain;
}

.upload-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: clamp(12px, 2vw, 18px);
  height: 100%;
  padding: clamp(12px, 2.4vw, 22px);
  overflow: hidden;
}

.detail-header,
.upload-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.detail-upload-button {
  min-height: 40px;
  max-width: 112px;
  padding: 0 12px;
  font-size: 13px;
  white-space: nowrap;
}

h2 {
  margin: 0;
  font-size: clamp(24px, 4vw, 40px);
  line-height: 1.08;
  letter-spacing: 0;
}

.detail-file {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 14px;
}

.logo-quality-warning {
  display: block;
  width: fit-content;
  max-width: 100%;
  margin-top: 10px;
  padding: 8px 10px;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 34%, transparent);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.35;
  text-align: left;
}

.logo-quality-warning:hover,
.logo-quality-warning:focus-visible {
  border-color: var(--warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 22%, transparent);
  outline: none;
}

.close-button {
  width: 40px;
  height: 40px;
  padding: 0;
  color: var(--text);
  background: var(--surface-muted);
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: pointer;
  font-size: 28px;
  line-height: 1;
}

.close-button:hover,
.close-button:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
  outline: none;
}

.upload-content {
  display: grid;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding-right: 8px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.72;
  overscroll-behavior: contain;
}

.upload-content p,
.upload-content ul,
.upload-content ol {
  margin: 0;
}

.upload-content ul,
.upload-content ol {
  padding-left: 1.4em;
}

.upload-content li + li,
.upload-content li > ol {
  margin-top: 6px;
}

.identity-note {
  padding: 10px 12px;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 34%, transparent);
  border-radius: 8px;
  font-weight: 800;
}

.upload-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.copy-status {
  min-width: min(100%, 220px);
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.copy-status.copied {
  color: var(--accepted);
}

.copy-status.failed {
  color: var(--danger);
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}

.preview-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.preview-panel h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.preview-canvas {
  display: grid;
  place-items: center;
  min-width: 0;
  height: clamp(170px, 32dvh, 300px);
  padding: clamp(18px, 4vw, 42px);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.preview-white .preview-canvas {
  background: #ffffff;
}

.preview-black .preview-canvas {
  background: #070806;
  border-color: #22251f;
}

.preview-black h3 {
  color: var(--text);
}

.logo-sample {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 14px;
  place-items: center;
  width: 100%;
  height: 100%;
  min-width: 0;
}

.detail-logo {
  display: block;
  width: clamp(108px, 48%, 190px);
  height: clamp(108px, 48%, 190px);
  max-width: 60%;
  max-height: 76%;
  object-fit: contain;
}

.sample-team-name {
  max-width: 100%;
  overflow: hidden;
  color: #111827;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.25;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-black .sample-team-name {
  color: #f3f7ef;
}

.scoreboard-panel {
  grid-column: 1 / -1;
}

.scoreboard-stack {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.scoreboard-card {
  display: grid;
  min-width: 0;
  overflow: hidden;
  border-radius: 8px;
}

.scoreboard-light {
  color: #151914;
  background: #ffffff;
  border: 1px solid #d5deea;
}

.scoreboard-dark {
  color: #f3f7ef;
  background: #151915;
  border: 1px solid #333b34;
}

.scoreboard-head,
.scoreboard-row {
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr) 86px 96px;
  align-items: center;
}

.scoreboard-head {
  min-height: 30px;
  padding: 0 14px;
  color: #5d6659;
  background: #eef2ec;
  border-bottom: 1px solid #d7ded5;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.scoreboard-head span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scoreboard-head span:nth-child(3),
.scoreboard-head span:nth-child(4) {
  text-align: right;
}

.scoreboard-dark .scoreboard-head {
  color: #b7c1b4;
  background: #202720;
  border-bottom-color: #333b34;
}

.scoreboard-row {
  min-height: 92px;
  padding: 14px;
  background: #ffffff;
}

.scoreboard-dark .scoreboard-row {
  background: #151915;
}

.rank-cell {
  color: var(--accent-strong);
  font-size: 28px;
  font-weight: 900;
}

.scoreboard-dark .rank-cell {
  color: var(--score-accent-dark);
}

.team-cell {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  min-width: 0;
}

.scoreboard-logo {
  width: 52px;
  height: 52px;
  justify-self: center;
  object-fit: contain;
}

.team-copy {
  display: grid;
  gap: 9px;
  min-width: 0;
}

.team-copy strong {
  overflow: hidden;
  font-size: 18px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem-strip {
  display: flex;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.problem-strip span {
  display: grid;
  flex: 1 1 0;
  min-width: 0;
  height: 28px;
  place-items: center;
  color: #ffffff;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 900;
}

.score-cell,
.penalty-cell {
  font-size: 22px;
  font-weight: 900;
  text-align: right;
}

.score-cell {
  color: var(--accent-strong);
}

.scoreboard-dark .score-cell {
  color: var(--score-accent-dark);
}

.penalty-cell {
  color: var(--warning);
}

.scoreboard-dark .penalty-cell {
  color: var(--warning);
}

.accepted {
  background: var(--accepted);
}

.failed {
  background: var(--danger);
}

.pending {
  background: var(--pending);
}

@media (max-width: 800px) {
  .app-shell {
    width: min(100% - 20px, 760px);
    padding-top: 10px;
  }

  .app-header {
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 14px 0;
  }

  .toolbar {
    grid-template-columns: 1fr;
  }

  .toolbar-side {
    justify-items: stretch;
  }

  .toolbar-actions {
    justify-content: flex-start;
  }

  .logo-count {
    text-align: left;
  }

  .theme-toggle,
  .upload-info-button,
  .help-link {
    flex: 0 0 44px;
  }

  .upload-info-button {
    max-width: none;
  }

  .logo-grid {
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    gap: 10px;
  }

  .logo-card {
    grid-template-rows: minmax(96px, 1fr) 44px;
    min-height: 160px;
    padding: 10px;
  }

  .preview-grid {
    grid-template-columns: 1fr;
  }

  .preview-canvas {
    height: clamp(136px, 26dvh, 220px);
    padding: 18px;
  }

  .detail-logo {
    width: clamp(92px, 44%, 150px);
    height: clamp(92px, 44%, 150px);
    max-width: 54%;
    max-height: 70%;
  }

  .scoreboard-head,
  .scoreboard-row {
    grid-template-columns: 48px minmax(0, 1fr) 62px 72px;
  }

  .scoreboard-head {
    padding: 0 10px;
    font-size: 10px;
  }

  .scoreboard-row {
    min-height: 82px;
    padding: 10px;
  }

  .rank-cell {
    font-size: 22px;
  }

  .team-cell {
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 9px;
  }

  .scoreboard-logo {
    width: 40px;
    height: 40px;
  }

  .team-copy strong {
    font-size: 15px;
  }

  .problem-strip {
    gap: 3px;
  }

  .problem-strip span {
    height: 24px;
    font-size: 12px;
  }

  .score-cell,
  .penalty-cell {
    font-size: 18px;
  }
}

@media (max-width: 520px) {
  .detail-dialog {
    width: calc(100dvw - 10px);
    max-width: calc(100dvw - 10px);
    max-height: calc(100dvh - 10px);
  }

  .upload-dialog {
    width: calc(100dvw - 10px);
    max-width: calc(100dvw - 10px);
    height: calc(100dvh - 28px);
    max-height: calc(100dvh - 28px);
  }

  .detail-shell {
    max-height: calc(100dvh - 10px);
    padding: 10px;
  }

  .upload-shell {
    padding: 10px;
  }

  .detail-header,
  .upload-header {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .close-button {
    width: 36px;
    height: 36px;
  }

  .detail-actions {
    gap: 6px;
  }

  .detail-upload-button {
    min-height: 36px;
    max-width: 150px;
    padding: 0 10px;
    font-size: 12px;
  }

  h2 {
    font-size: clamp(20px, 7vw, 28px);
  }

  .preview-grid {
    gap: 10px;
  }

  .preview-panel {
    gap: 8px;
  }

  .detail-logo {
    width: clamp(84px, 42%, 128px);
    height: clamp(84px, 42%, 128px);
  }

  .sample-team-name {
    font-size: 13px;
  }

  .upload-content {
    font-size: 13px;
    line-height: 1.62;
  }

  .upload-footer {
    align-items: stretch;
  }

  .mail-action,
  .copy-status {
    flex: 1 1 100%;
  }

  .scoreboard-head,
  .scoreboard-row {
    grid-template-columns: 38px minmax(0, 1fr) 44px 54px;
  }

  .scoreboard-head {
    min-height: 26px;
    padding: 0 8px;
    font-size: 9px;
  }

  .scoreboard-row {
    min-height: 76px;
    padding: 8px;
  }

  .rank-cell {
    font-size: 18px;
  }

  .team-cell {
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 7px;
  }

  .scoreboard-logo {
    width: 32px;
    height: 32px;
  }

  .team-copy {
    gap: 7px;
  }

  .team-copy strong {
    font-size: 14px;
  }

  .problem-strip span {
    height: 22px;
    font-size: 11px;
  }

  .score-cell,
  .penalty-cell {
    font-size: 16px;
  }
}

@media (max-height: 720px) {
  .preview-canvas {
    height: clamp(128px, 24dvh, 180px);
    padding: 18px;
  }

  .detail-logo {
    width: clamp(78px, 40%, 130px);
    height: clamp(78px, 40%, 130px);
  }

  .scoreboard-row {
    min-height: 76px;
  }

  .problem-strip span {
    height: 22px;
  }
}
`;
