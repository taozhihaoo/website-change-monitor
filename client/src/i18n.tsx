import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export type Locale = 'en' | 'zh';

const LOCALE_KEY = 'wcm.locale';

type Dict = Record<string, string>;

const en: Dict = {
  'app.name': 'Website Change Monitor',
  'app.tagline': 'Self-hosted page change detection',
  'app.footer':
    'For monitoring public pages you are authorized to access — respect robots.txt and the target site’s terms.',

  'nav.dashboard': 'Dashboard',
  'nav.add': 'Add monitor',

  'action.refresh': 'Refresh',
  'action.addMonitor': 'Add monitor',
  'action.runNow': 'Run now',
  'action.run': 'Run',
  'action.checking': 'Checking…',
  'action.edit': 'Edit',
  'action.closeEditor': 'Close editor',
  'action.delete': 'Delete',
  'action.cancel': 'Cancel',
  'action.save': 'Save and continue',
  'action.enable': 'Enable',
  'action.disable': 'Disable',
  'action.retry': 'Retry',
  'action.testExtraction': 'Test extraction',
  'action.testing': 'Testing…',
  'action.sendTest': 'Send test notification',
  'action.sending': 'Sending…',
  'action.working': 'Working…',
  'action.back': 'All monitors',
  'action.createMonitor': 'Create monitor',
  'action.saveChanges': 'Save changes',

  'status.baseline': 'baseline',
  'status.unchanged': 'unchanged',
  'status.changed': 'changed',
  'status.error': 'error',
  'status.never': 'never checked',
  'status.enabled': 'enabled',
  'status.disabled': 'disabled',
  'status.pending': 'pending',
  'status.sent': 'sent',
  'status.failed': 'failed',

  'dashboard.eyebrow': 'Monitoring overview',
  'dashboard.title': 'Dashboard',
  'dashboard.subtitle': 'Every monitored page, its latest result and the next scheduled check.',
  'dashboard.table.title': 'All monitors',
  'dashboard.table.count': '{n} monitors · {active} enabled',
  'dashboard.loading': 'Loading dashboard…',
  'dashboard.stat.monitors': 'Monitors',
  'dashboard.stat.active': 'Active',
  'dashboard.stat.failing': 'Failing',
  'dashboard.stat.changes': 'Changes detected',
  'dashboard.stat.lastCheck': 'Last check',
  'dashboard.empty.title': 'No monitors yet',
  'dashboard.empty.hint': 'Add a monitor to start watching a page for changes.',
  'dashboard.empty.action': 'Create your first monitor',
  'dashboard.table.name': 'Monitor',
  'dashboard.table.url': 'URL',
  'dashboard.table.status': 'Status',
  'dashboard.table.lastChecked': 'Last checked',
  'dashboard.table.lastChanged': 'Last changed',
  'dashboard.table.nextCheck': 'Next check',
  'dashboard.table.interval': 'Interval',
  'dashboard.table.actions': 'Actions',
  'dashboard.runResult': '“{name}” finished with status: {status}',

  'monitor.loading': 'Loading monitor…',
  'monitor.configuration': 'Configuration',
  'monitor.url': 'URL',
  'monitor.selector': 'Selector',
  'monitor.interval': 'Interval',
  'monitor.schedule': 'Schedule',
  'monitor.lastChecked': 'Last checked',
  'monitor.nextCheck': 'Next check',
  'monitor.webhook': 'Webhook',
  'monitor.notifyEmail': 'Notification email',
  'monitor.notConfigured': 'not configured',
  'monitor.latestContent': 'Latest extracted content',
  'monitor.noSnapshot': 'No snapshot yet',
  'monitor.noSnapshotHint': 'Run a check to capture the first baseline.',
  'monitor.captured': 'captured',
  'monitor.changeHistory': 'Change history',
  'monitor.noChanges': 'No changes detected yet',
  'monitor.noChangesHint': 'The first check stores a baseline; changes will appear here.',
  'monitor.previous': 'Previous',
  'monitor.current': 'Current',
  'monitor.diff': 'Line diff',
  'monitor.checkHistory': 'Check history',
  'monitor.noChecks': 'No checks yet',
  'monitor.noChecksHint': 'Use “Run now” to trigger the first check.',
  'monitor.trigger': 'Trigger',
  'trigger.schedule': 'schedule',
  'trigger.manual': 'manual',
  'trigger.test': 'test',
  'monitor.started': 'Started',
  'monitor.duration': 'Duration',
  'monitor.error': 'Error',
  'monitor.updated': 'Monitor updated.',
  'monitor.checkFinished': 'Check finished: {status}',
  'monitor.deleteTitle': 'Delete monitor',
  'monitor.deleteMessage':
    'Delete “{name}”? Its snapshots, change events and check history will be removed. This cannot be undone.',
  'monitor.testNotification': 'Test notification — {summary}.',

  'form.name': 'Name',
  'form.namePlaceholder': 'Acme product price',
  'form.url': 'URL',
  'form.urlPlaceholder': 'https://example.com/product',
  'form.urlHint': 'Public pages only — localhost and private-network targets are rejected.',
  'form.selector': 'Selector',
  'form.selectorPlaceholder': '.product-price',
  'form.selectorType': 'Selector type',
  'form.interval': 'Check interval',
  'form.webhook': 'Webhook URL (optional)',
  'form.webhookPlaceholder': 'https://hooks.example.com/…',
  'form.webhookHint': 'Receives a JSON POST whenever a change is detected.',
  'form.email': 'Notification email (optional)',
  'form.emailHint': 'Requires SMTP on the server. Sends a compact change email.',
  'form.emailPlaceholder': 'owner@example.com',
  'form.enabled': 'Enabled — scheduled checks run only when enabled',
  'form.sectionTarget': 'What to watch',
  'form.sectionSchedule': 'Schedule',
  'form.sectionNotify': 'Notifications',
  'form.extractionPreview': 'Extraction preview',
  'form.extractionPreviewHint':
    'This normalized text is what will be monitored and hashed. Nothing is saved.',
  'form.addTitle': 'Add monitor',
  'form.addSubtitle':
    'Point the monitor at a public page, pick the content to watch, and verify the selector before saving.',

  'auth.title': 'API key required',
  'auth.intro':
    'This instance is protected with an API key (APP_API_KEY). Enter it once — it is stored in this browser and sent as a Bearer token.',
  'auth.label': 'API key',

  'empty.runFirst': 'Run the first check',

  'error.title': 'Error',
  'error.pageNotFound': 'Page not found.',
  'error.network': 'Cannot reach the server. Is the backend running?',

  'unit.min': '{n} min',
  'unit.hour': '{n} h',
  'unit.hours': '{n} h',
  'unit.day': '{n} day',
  'unit.days': '{n} days',

  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.toggle': 'Toggle theme',
  'language.toggle': 'Switch language',
};

const zh: Dict = {
  'app.name': '网站变更监控',
  'app.tagline': '自托管网页变更检测',
  'app.footer': '仅用于监控你有权访问的公开页面 —— 请遵守 robots.txt 与目标站点的服务条款。',

  'nav.dashboard': '仪表盘',
  'nav.add': '添加监控',

  'action.refresh': '刷新',
  'action.addMonitor': '添加监控',
  'action.runNow': '立即检查',
  'action.run': '检查',
  'action.checking': '检查中…',
  'action.edit': '编辑',
  'action.closeEditor': '关闭编辑',
  'action.delete': '删除',
  'action.cancel': '取消',
  'action.save': '保存并继续',
  'action.enable': '启用',
  'action.disable': '停用',
  'action.retry': '重试',
  'action.testExtraction': '测试提取',
  'action.testing': '测试中…',
  'action.sendTest': '发送测试通知',
  'action.sending': '发送中…',
  'action.working': '处理中…',
  'action.back': '全部监控',
  'action.createMonitor': '创建监控',
  'action.saveChanges': '保存修改',

  'status.baseline': '已建立基线',
  'status.unchanged': '无变化',
  'status.changed': '有变化',
  'status.error': '失败',
  'status.never': '尚未检查',
  'status.enabled': '已启用',
  'status.disabled': '已停用',
  'status.pending': '待发送',
  'status.sent': '已发送',
  'status.failed': '失败',

  'dashboard.eyebrow': '监控总览',
  'dashboard.title': '仪表盘',
  'dashboard.subtitle': '所有监控页面、最近一次结果以及下一次检查时间。',
  'dashboard.table.title': '所有监控',
  'dashboard.table.count': '共 {n} 个监控 · {active} 个已启用',
  'dashboard.loading': '正在加载仪表盘…',
  'dashboard.stat.monitors': '监控总数',
  'dashboard.stat.active': '运行中',
  'dashboard.stat.failing': '异常',
  'dashboard.stat.changes': '累计变更',
  'dashboard.stat.lastCheck': '最近检查',
  'dashboard.empty.title': '还没有监控',
  'dashboard.empty.hint': '添加一个监控，开始跟踪页面变化。',
  'dashboard.empty.action': '创建第一个监控',
  'dashboard.table.name': '名称',
  'dashboard.table.url': '网址',
  'dashboard.table.status': '状态',
  'dashboard.table.lastChecked': '上次检查',
  'dashboard.table.lastChanged': '上次变更',
  'dashboard.table.nextCheck': '下次检查',
  'dashboard.table.interval': '间隔',
  'dashboard.table.actions': '操作',
  'dashboard.runResult': '“{name}” 检查完成，状态：{status}',

  'monitor.loading': '正在加载监控…',
  'monitor.configuration': '配置',
  'monitor.url': '网址',
  'monitor.selector': '选择器',
  'monitor.interval': '检查间隔',
  'monitor.schedule': '调度',
  'monitor.lastChecked': '上次检查',
  'monitor.nextCheck': '下次检查',
  'monitor.webhook': 'Webhook',
  'monitor.notifyEmail': '通知邮箱',
  'monitor.notConfigured': '未配置',
  'monitor.latestContent': '最新提取内容',
  'monitor.noSnapshot': '还没有快照',
  'monitor.noSnapshotHint': '运行一次检查以建立基线。',
  'monitor.captured': '采集于',
  'monitor.changeHistory': '变更历史',
  'monitor.noChanges': '尚未检测到变更',
  'monitor.noChangesHint': '首次检查会建立基线，之后的变更会显示在这里。',
  'monitor.previous': '变更前',
  'monitor.current': '变更后',
  'monitor.diff': '行级差异',
  'monitor.checkHistory': '检查历史',
  'monitor.noChecks': '还没有检查记录',
  'monitor.noChecksHint': '点击“立即检查”运行第一次检查。',
  'monitor.trigger': '触发方式',
  'trigger.schedule': '定时',
  'trigger.manual': '手动',
  'trigger.test': '测试',
  'monitor.started': '开始时间',
  'monitor.duration': '耗时',
  'monitor.error': '错误',
  'monitor.updated': '监控已更新。',
  'monitor.checkFinished': '检查完成：{status}',
  'monitor.deleteTitle': '删除监控',
  'monitor.deleteMessage':
    '确定删除“{name}”？它的快照、变更事件和检查历史都会被移除，且无法恢复。',
  'monitor.testNotification': '测试通知 — {summary}。',

  'form.name': '名称',
  'form.namePlaceholder': 'Acme 商品价格',
  'form.url': '网址',
  'form.urlPlaceholder': 'https://example.com/product',
  'form.urlHint': '仅支持公开页面 —— 本地与内网地址会被拒绝。',
  'form.selector': '选择器',
  'form.selectorPlaceholder': '.product-price',
  'form.selectorType': '选择器类型',
  'form.interval': '检查间隔',
  'form.webhook': 'Webhook 地址（可选）',
  'form.webhookPlaceholder': 'https://hooks.example.com/…',
  'form.webhookHint': '检测到变更时，会向该地址发送 JSON POST 请求。',
  'form.email': '通知邮箱（可选）',
  'form.emailHint': '需要在服务端配置 SMTP。会发送一封简洁的变更邮件。',
  'form.emailPlaceholder': 'owner@example.com',
  'form.enabled': '启用 —— 只有启用后才会按计划自动检查',
  'form.sectionTarget': '监控目标',
  'form.sectionSchedule': '调度',
  'form.sectionNotify': '通知',
  'form.extractionPreview': '提取预览',
  'form.extractionPreviewHint': '下面这段规范化文本就是将被监控与计算哈希的内容，不会保存任何数据。',
  'form.addTitle': '添加监控',
  'form.addSubtitle': '指向一个公开页面，选择要关注的内容，并在保存前验证选择器。',

  'auth.title': '需要 API 密钥',
  'auth.intro':
    '此实例已启用 API 密钥（APP_API_KEY）。输入一次后会保存在浏览器中，并以 Bearer Token 发送。',
  'auth.label': 'API 密钥',

  'empty.runFirst': '运行第一次检查',

  'error.title': '错误',
  'error.pageNotFound': '页面不存在。',
  'error.network': '无法连接服务器，请确认后端正在运行。',

  'unit.min': '{n} 分钟',
  'unit.hour': '{n} 小时',
  'unit.hours': '{n} 小时',
  'unit.day': '{n} 天',
  'unit.days': '{n} 天',

  'theme.light': '浅色',
  'theme.dark': '深色',
  'theme.toggle': '切换主题',
  'language.toggle': '切换语言',
};

const DICTS: Record<Locale, Dict> = { en, zh };

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === 'en' || stored === 'zh') {
      return stored;
    }
  } catch {
    // storage unavailable — fall through to the browser language
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en';
}

export interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  dateTime: (iso: string | null) => string;
  /** Compact form for tables: time-only for today, date-only otherwise. */
  dateTimeShort: (iso: string | null) => string;
  interval: (seconds: number) => string;
  number: (value: number) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // ignore storage failures (private mode)
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const t = (key: string, params?: Record<string, string | number>): string => {
      const template = DICTS[locale][key] ?? en[key] ?? key;
      return interpolate(template, params);
    };

    const dateTime = (iso: string | null): string => {
      if (iso === null) {
        return '—';
      }
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) {
        return iso;
      }
      const sameYear = date.getFullYear() === new Date().getFullYear();
      return date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
        ...(sameYear ? {} : { year: 'numeric' }),
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const dateTimeShort = (iso: string | null): string => {
      if (iso === null) {
        return '—';
      }
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) {
        return iso;
      }
      const now = new Date();
      const sameDay = date.toDateString() === now.toDateString();
      const sameYear = date.getFullYear() === now.getFullYear();
      const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
      if (sameDay) {
        return date.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString(tag, {
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
      });
    };

    const interval = (seconds: number): string => {
      if (seconds < 3600) {
        return t('unit.min', { n: Math.round(seconds / 60) });
      }
      if (seconds < 86400) {
        const hours = seconds / 3600;
        const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
        return t('unit.hours', { n: rounded });
      }
      return t('unit.days', { n: seconds / 86400 });
    };

    const number = (input: number): string => input.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');

    return { locale, setLocale, t, dateTime, dateTimeShort, interval, number };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) {
    throw new Error('useI18n must be used inside <I18nProvider>.');
  }
  return value;
}
