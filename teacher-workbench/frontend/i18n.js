/* i18n.js — 全局界面语言基础层（en / zh-CN / zh-TW） */
(function () {
  const STORAGE_KEY = 'wb_locale';
  const UI_TEXT = {
    '工作台首页': ['Workbench Home', '工作台首頁'],
    '我的班级': ['My Classes', '我的班級'],
    '备课中心': ['Lesson Planning', '備課中心'],
    '教学课表': ['Schedule', '教學課表'],
    '学生管理': ['Students', '學生管理'],
    '作业统计': ['Assignments', '作業統計'],
    '默写管理': ['Dictations', '默寫管理'],
    '考试成绩': ['Exams', '考試成績'],
    '待办中心': ['Todos', '待辦中心'],
    'AI 教学助手': ['AI Assistant', 'AI 教學助手'],
    '回收站': ['Recycle Bin', '回收站'],
    '设置': ['Settings', '設定'],
    '平台管理': ['Platform Admin', '平台管理'],
    '配额管理': ['Quota', '配額管理'],
    '退出登录': ['Log out', '登出'],
    '加载中': ['Loading', '載入中'],
    '保存': ['Save', '儲存'],
    '取消': ['Cancel', '取消'],
    '关闭': ['Close', '關閉'],
    '确认': ['Confirm', '確認'],
    '删除': ['Delete', '刪除'],
    '编辑': ['Edit', '編輯'],
    '新增': ['Add', '新增'],
    '搜索': ['Search', '搜尋'],
    '刷新': ['Refresh', '重新整理'],
    '导出': ['Export', '匯出'],
    '导入': ['Import', '匯入'],
    '提交': ['Submit', '提交'],
    '重置': ['Reset', '重設'],
    '返回': ['Back', '返回'],
    '上一页': ['Previous', '上一頁'],
    '下一页': ['Next', '下一頁'],
    '暂无数据': ['No data', '暫無資料'],
    '暂无内容': ['No content', '暫無內容'],
    '暂无记录': ['No records', '暫無紀錄'],
    '操作成功': ['Done', '操作成功'],
    '保存成功': ['Saved', '儲存成功'],
    '保存失败': ['Save failed', '儲存失敗'],
    '加载失败': ['Loading failed', '載入失敗'],
    '请求失败': ['Request failed', '請求失敗'],
    '网络错误': ['Network error', '網路錯誤'],
    '请输入': ['Please enter', '請輸入'],
    '请选择': ['Please select', '請選擇'],
    '全部': ['All', '全部'],
    '是': ['Yes', '是'],
    '否': ['No', '否'],
    '启用': ['Enabled', '啟用'],
    '禁用': ['Disabled', '停用'],
    '启用中': ['Enabled', '啟用中'],
    '已完成': ['Completed', '已完成'],
    '未完成': ['Incomplete', '未完成'],
    '待处理': ['Pending', '待處理'],
    '显示': ['Display', '顯示'],
    '界面语言': ['Interface language', '介面語言'],
    '电脑模式': ['Desktop mode', '電腦模式'],
    '平板模式': ['Tablet mode', '平板模式'],
    '登录': ['Log in', '登入'],
    '注册': ['Sign up', '註冊'],
    '注册并进入': ['Sign up and enter', '註冊並進入'],
    '邮箱': ['Email', '電子郵件'],
    '姓名': ['Name', '姓名'],
    '密码': ['Password', '密碼'],
    '免费试用 3 天': ['Try free for 3 days', '免費試用 3 天'],
    '功能': ['Features', '功能'],
    '定价': ['Pricing', '定價'],
    '一站式教学工作台': ['All-in-one teaching workbench', '一站式教學工作台'],
    '操作失败，请重试': ['Operation failed. Please try again.', '操作失敗，請重試'],
    '英语词典': ['English Dictionary', '英語詞典'],
    '收起': ['Collapse', '收起'],
    '输入英文单词，回车查词': ['Enter an English word and press Enter', '輸入英文單詞，按 Enter 查詞'],
    '加载词库中…': ['Loading dictionary…', '載入詞庫中…'],
  };
  const messages = {
    'zh-CN': {
      appTitle: '英语教师教学工作台', dashboard: '工作台首页',
      home: '工作台首页', classes: '我的班级', lessons: '备课中心', schedule: '教学课表',
      students: '学生管理', assignments: '作业统计', dictations: '默写管理', exams: '考试成绩',
      todos: '待办中心', ai: 'AI 教学助手', recycle: '回收站', settings: '设置', admin: '平台管理',
      logout: '退出登录', language: '界面语言', loading: '加载中', quota: '配额管理',
    },
    'zh-TW': {
      appTitle: '英語教師教學工作台', dashboard: '工作台首頁',
      home: '工作台首頁', classes: '我的班級', lessons: '備課中心', schedule: '教學課表',
      students: '學生管理', assignments: '作業統計', dictations: '默寫管理', exams: '考試成績',
      todos: '待辦中心', ai: 'AI 教學助手', recycle: '回收站', settings: '設定', admin: '平台管理',
      logout: '登出', language: '介面語言', loading: '載入中', quota: '配額管理',
    },
    en: {
      appTitle: 'English Teacher Workbench', dashboard: 'Workbench Home',
      home: 'Workbench Home', classes: 'My Classes', lessons: 'Lesson Planning', schedule: 'Schedule',
      students: 'Students', assignments: 'Assignments', dictations: 'Dictations', exams: 'Exams',
      todos: 'Todos', ai: 'AI Assistant', recycle: 'Recycle Bin', settings: 'Settings', admin: 'Platform Admin',
      logout: 'Log out', language: 'Language', loading: 'Loading', quota: 'Quota',
    },
  };

  function detectLocale() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && messages[saved]) return saved;
    const language = navigator.language || 'zh-CN';
    if (language === 'zh-TW' || language === 'zh-HK') return 'zh-TW';
    if (language.startsWith('en')) return 'en';
    return 'zh-CN';
  }

  const I18n = {
    locale: detectLocale(),
    t(key, fallback) {
      return messages[this.locale]?.[key] ?? messages['zh-CN'][key] ?? fallback ?? key;
    },
    text(source, fallback) {
      const value = UI_TEXT[source];
      if (value) return this.locale === 'en' ? value[0] : this.locale === 'zh-TW' ? value[1] : source;
      return fallback ?? source;
    },
    formatNumber(value, options) {
      return new Intl.NumberFormat(this.locale, options).format(Number(value) || 0);
    },
    formatDate(value, options) {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value ?? '');
      return new Intl.DateTimeFormat(this.locale, options || { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    },
    setLocale(locale) {
      if (!messages[locale] || locale === this.locale) return false;
      localStorage.setItem(STORAGE_KEY, locale);
      this.locale = locale;
      document.documentElement.lang = locale;
      return true;
    },
    apply(root = document) {
      document.documentElement.lang = this.locale;
      const select = (selector) => {
        const elements = Array.from(root.querySelectorAll(selector));
        if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) elements.unshift(root);
        return elements;
      };
      select('[data-i18n]').forEach((el) => {
        el.textContent = this.t(el.dataset.i18n, el.textContent);
      });
      select('[data-i18n-title]').forEach((el) => {
        el.title = this.t(el.dataset.i18nTitle, el.title);
      });
      select('[data-i18n-placeholder]').forEach((el) => {
        el.placeholder = this.t(el.dataset.i18nPlaceholder, el.placeholder);
      });
      this.translateTextNodes(root);
    },
    translateTextNodes(root = document) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        const parent = node.parentElement;
        if (!parent || /^(SCRIPT|STYLE|TEXTAREA|OPTION)$/i.test(parent.tagName)) return;
        const source = node.nodeValue.trim();
        if (!source || !UI_TEXT[source]) return;
        const translated = this.text(source);
        if (translated !== source) {
          node.nodeValue = node.nodeValue.replace(source, translated);
        }
      });
    },
  };

  window.I18n = I18n;
  document.addEventListener('DOMContentLoaded', () => {
    I18n.apply();
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) I18n.apply(node);
        });
      });
    });
    ['view-container', 'modal-root', 'toast-root', 'upload-progress'].forEach((id) => {
      const root = document.getElementById(id);
      if (root) observer.observe(root, { childList: true, subtree: true });
    });
  });
  window.addEventListener('wb:i18n', () => I18n.apply());
})();
