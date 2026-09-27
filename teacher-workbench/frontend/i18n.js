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
    '加载中…': ['Loading…', '載入中…'],
    '加载失败，请稍后重试': ['Loading failed. Please try again.', '載入失敗，請稍後重試'],
    '加载失败': ['Loading failed', '載入失敗'],
    '操作失败': ['Operation failed', '操作失敗'],
    '操作成功': ['Done', '操作成功'],
    '班主任：': ['Class teacher: ', '班主任：'],
    '年级组：': ['Grade group: ', '年級組：'],
    '任课：': ['Subject teachers: ', '任課：'],
    '班均分趋势': ['Class average trend', '班均分趨勢'],
    '暂无班级': ['No classes', '暫無班級'],
    '暂无任课老师': ['No subject teachers', '暫無任課老師'],
    '学生数': ['Students', '學生數'],
    '名学生': [' students', '名學生'],
    '查看学生': ['View students', '查看學生'],
    '任课老师': ['Subject teacher', '任課老師'],
    '移除任课老师': ['Remove subject teacher', '移除任課老師'],
    '设置老师': ['Set teachers', '設定老師'],
    '下载': ['Download', '下載'],
    '下载中…': ['Downloading…', '下載中…'],
    '编辑班级': ['Edit class', '編輯班級'],
    '新建班级': ['New class', '新增班級'],
    '班级名称': ['Class name', '班級名稱'],
    '年级': ['Grade', '年級'],
    '毕业年份': ['Graduation year', '畢業年份'],
    '取消': ['Cancel', '取消'],
    '创建': ['Create', '建立'],
    '确定': ['Confirm', '確定'],
    '未设置': ['Not set', '未設定'],
    '全部': ['All', '全部'],
    '今天': ['Today', '今天'],
    '逾期': ['Overdue', '逾期'],
    '已归档': ['Archived', '已歸檔'],
    '已完成': ['Completed', '已完成'],
    '未完成': ['Incomplete', '未完成'],
    '待处理': ['Pending', '待處理'],
    '恢复': ['Restore', '恢復'],
    '上传': ['Upload', '上傳'],
    '下载归档': ['Download archive', '下載歸檔'],
    '新建': ['New', '新增'],
    '详情': ['Details', '詳情'],
    '查看': ['View', '查看'],
    '返回': ['Back', '返回'],
    '重试': ['Retry', '重試'],
    '清除': ['Clear', '清除'],
    '导出统计': ['Export statistics', '匯出統計'],
    '导出名单': ['Export roster', '匯出名單'],
    '选择班级': ['Select class', '選擇班級'],
    '选择成员…': ['Choose a member…', '選擇成員…'],
    '无': ['None', '無'],
    '暂无': ['None', '暫無'],
    '暂无作业': ['No assignments', '暫無作業'],
    '暂无学生': ['No students', '暫無學生'],
    '暂无考试': ['No exams', '暫無考試'],
    '暂无待办': ['No todos', '暫無待辦'],
    '请输入标题': ['Enter a title', '請輸入標題'],
    '请选择班级': ['Select a class', '請選擇班級'],
    '请选择成员': ['Please choose a member', '請選擇成員'],
    '请输入内容': ['Enter content', '請輸入內容'],
    '保存成功': ['Saved', '儲存成功'],
    '删除成功': ['Deleted', '刪除成功'],
    '恢复成功': ['Restored', '恢復成功'],
    '加载失败，请稍后重试': ['Loading failed. Please try again.', '載入失敗，請稍後重試'],
    '网络错误': ['Network error', '網路錯誤'],
    '文件上传失败': ['File upload failed', '檔案上傳失敗'],
    '未重默名单': ['Students pending retest', '待重默名單'],
    '重默': ['Retest', '重默'],
    '人': [' people', '人'],
    '待重默': [' pending retest', '待重默'],
    '生成于': ['Generated at', '產生於'],
    '图片生成失败': ['Failed to generate image', '圖片產生失敗'],
    '已保存到图片': ['Saved to Pictures', '已儲存到圖片'],
    '全部状态': ['All statuses', '全部狀態'],
    '全部班级': ['All classes', '全部班級'],
    '全部课型': ['All lesson types', '全部課型'],
    '搜索标题，回车确认': ['Search title, press Enter to confirm', '搜尋標題，按 Enter 確認'],
    '只看我的': ['Mine only', '只看我的'],
    '只看我的课': ['My lessons only', '只看我的課'],
    '年级组': ['Grade group', '年級組'],
    '需重默': ['Needs retest', '需重默'],
    '无附件': ['No attachments', '無附件'],
    '创建信息': ['Created', '建立資訊'],
    '未指定班级': ['No class specified', '未指定班級'],
    '未填写': ['Not provided', '未填寫'],
    '未填写教案正文': ['Lesson body not provided', '未填寫教案正文'],
    '按班级统计作业提交情况，统计数字由后端实时计算': ['Assignment statistics by class; figures are calculated by the server', '按班級統計作業提交情況，統計數字由後端即時計算'],
    '支持班级默写与全年段默写，未过学生可标记重默': ['Class and grade-wide dictations are supported; students who fail can be marked for retest', '支援班級默寫與全年段默寫，未過學生可標記重默'],
    '待办仅自己可见': ['Todos are visible only to you', '待辦僅自己可見'],
    '请为以下课题撰写一份完整教案：': ['Write a complete lesson plan for the following topic:', '請為以下課題撰寫一份完整教案：'],
    '你是我的 AI 教学助手。': ['You are my AI teaching assistant.', '你是我的 AI 教學助手。'],
    '请选择学生': ['Please select a student', '請選擇學生'],
    '个学生待办': ['personal todos', '個人待辦'],
    '个人待办': ['Personal todos', '個人待辦'],
    '个学生': [' students', '個學生'],
    '当前服务方式': ['Current service', '目前服務方式'],
    '剩余 AI 额度': ['Remaining AI credits', '剩餘 AI 額度'],
    '新建教案': ['New lesson plan', '新增教案'],
    '教案详情': ['Lesson details', '教案詳情'],
    '添加学生': ['Add student', '新增學生'],
    '查看报告': ['View report', '查看報告'],
    '成绩分析': ['Score analysis', '成績分析'],
    '个性化报告': ['Personalized report', '個人化報告'],
    '班级统计': ['Class statistics', '班級統計'],
    '添加作业': ['Add assignment', '新增作業'],
    '新建作业': ['New assignment', '新增作業'],
    '新建默写': ['New dictation', '新增默寫'],
    '新建考试': ['New exam', '新增考試'],
    '导入成绩': ['Import scores', '匯入成績'],
    '导入小分': ['Import sub-scores', '匯入小分'],
    '上传试卷': ['Upload paper', '上傳試卷'],
    '创建待办': ['Create todo', '建立待辦'],
    '导出成绩': ['Export scores', '匯出成績'],
    '导出班级统计': ['Export class statistics', '匯出班級統計'],
    '登记上交': ['Record submissions', '登記繳交'],
    '截止': ['Due', '截止'],
    '提交率': ['Submission rate', '提交率'],
    '已交': ['Submitted', '已交'],
    '总': ['Total', '總'],
    '进行中': ['In progress', '進行中'],
    '置顶': ['Pin', '置頂'],
    '取消置顶': ['Unpin', '取消置頂'],
    '重默·班级': ['Retest · class', '重默·班級'],
    '上传材料': ['Upload material', '上傳材料'],
    '通过': ['Passed', '通過'],
    '未过': ['Failed', '未過'],
    '全年段': ['All grades', '全年段'],
    '时段': ['Period', '時段'],
    '周一': ['Monday', '週一'],
    '周二': ['Tuesday', '週二'],
    '周三': ['Wednesday', '週三'],
    '周四': ['Thursday', '週四'],
    '周五': ['Friday', '週五'],
    '周六': ['Saturday', '週六'],
    '周日': ['Sunday', '週日'],
    '早自习': ['Morning study', '早自習'],
    '第一节': ['Period 1', '第一節'],
    '第二节': ['Period 2', '第二節'],
    '第三节': ['Period 3', '第三節'],
    '第四节': ['Period 4', '第四節'],
    '第五节': ['Period 5', '第五節'],
    '第六节': ['Period 6', '第六節'],
    '第七节': ['Period 7', '第七節'],
    '第八节': ['Period 8', '第八節'],
    '第九节': ['Period 9', '第九節'],
    '第十节': ['Period 10', '第十節'],
    '晚自习': ['Evening study', '晚自習'],
    '导师组活动': ['Mentor group activity', '導師組活動'],
    '英语拓展': ['English enrichment', '英語拓展'],
    '今日': ['Today', '今日'],
    '恢复默认': ['Restore defaults', '恢復預設'],
    '恢复数据': ['Restore data', '恢復資料'],
    '导出全部数据': ['Export all data', '匯出全部資料'],
    '导出学生名单': ['Export student roster', '匯出學生名單'],
    '数据导入': ['Data import', '資料匯入'],
    '班级名单': ['Class roster', '班級名單'],
    '课表': ['Schedule', '課表'],
    '成绩小分': ['Score details', '成績小分'],
    '回收站': ['Recycle Bin', '回收站'],
    '保留 30 天': ['kept for 30 days', '保留 30 天'],
    '过期后自动清除': ['automatically cleared after expiry', '到期後自動清除'],
    '平台管理员': ['platform administrator', '平台管理員'],
    '联系管理员': ['contact an administrator', '聯絡管理員'],
    '设置': ['Settings', '設定'],
    '显示': ['Display', '顯示'],
    '设备模式': ['Device mode', '裝置模式'],
    '桌面模式': ['Desktop mode', '桌面模式'],
    '平板模式': ['Tablet mode', '平板模式'],
    '简体中文': ['Simplified Chinese', '簡體中文'],
    '繁體中文': ['Traditional Chinese', '繁體中文'],
    '切换语言后重新加载界面': ['Reload the interface after changing language', '切換語言後重新載入介面'],
  };
  const messages = {
    'zh-CN': {
      appTitle: '英语教师教学工作台', dashboard: '工作台首页',
      home: '工作台首页', classes: '我的班级', lessons: '备课中心', schedule: '教学课表',
      students: '学生管理', assignments: '作业统计', dictations: '默写管理', exams: '考试成绩',
      todos: '待办中心', ai: 'AI 教学助手', recycle: '回收站', settings: '设置', admin: '平台管理',
      logout: '退出登录', language: '界面语言', loading: '加载中', quota: '配额管理',
      dashLoading: '加载中…', dashTodaySchedule: '今日课表', dashLessonTodo: '备课中心待办', dashRecentAssignments: '最近布置作业',
      dashNoSchedule: '今天没有排课，去「教学课表」添加吧', dashNoLessonTodo: '备课中心没有待办，一切就绪 ✓', dashNoAssignments: '最近没有布置作业',
      dashMarkDone: '标记完成', dashUnnamedLesson: '未命名教案', dashUnnamedAssignment: '未命名作业', dashWholeGrade: '全年段', dashSubmitted: '已交',
      clsLoading: '加载中…', clsLoadFailed: '加载失败，请稍后重试', clsGroups: '年级组', clsGroupsCount: '年级组（{count}）', clsMyGroups: '我带领的年级组', clsMyGroupsCount: '我带领的年级组（{count}）', clsNewGroup: '新建年级组',
      clsNoGroups: '还没有年级组。年级组长可协助管理本组班级的班主任设置。', clsTotal: '共 {count} 个班级', clsNewClass: '新建班级',
      clsGradeGroup: '年级组', clsUngrouped: '未分组', clsHeadTeacher: '班主任', clsUnassigned: '未分配', clsTeacherAdjust: '班主任由空间管理员或年级组长调整', clsPrepLeader: '备课组长', clsSetLeader: '设组长', clsLeader: '组长', clsGroupClasses: '组内 {count} 个班', clsNoGroupClasses: '（暂无班级）', clsImportHint: '也可以通过「设置 → 数据导入」批量导入班级与学生',
      clsSubjectTeacher: '任课', clsAddTeacher: '任课老师', clsRemoveTeacher: '移除任课老师', clsEdit: '编辑', clsDelete: '删除', clsViewStudents: '查看学生',
      clsGraduated: '毕业 {year}', clsNotSet: '未设置年级/学年', clsGroupLabel: '年级组：', clsHeadTeacherLabel: '班主任：', clsStudents: '名学生',
      clsMyClasses: '我的班级（{count}）', clsOtherClasses: '其他班级（{count}）', clsNoClasses: '还没有班级，点击右上角「新建班级」开始创建', clsTrend: '班均分趋势', clsDownload: '下载', clsGradArchive: '已毕业班级归档（{count}）', clsGradLoadFailed: '毕业归档加载失败，请稍后重试', clsGradLoading: '加载中…', clsGradEmpty: '暂无毕业归档', clsClassName: '班级名', clsGradYear: '毕业年份', clsAcademicYear: '原学年', clsArchiveTime: '归档时间', clsAction: '操作', clsDownloadLoading: '下载中…', clsDownloadStarted: '毕业归档已开始下载', clsCreate: '创建', clsSave: '保存', clsCancel: '取消', clsClassNameRequired: '班级名称不能为空', clsGradYearInvalid: '毕业年份须为 2000–2100 的整数，或留空', clsSaved: '已保存', clsCreated: '班级创建成功', clsNewGroupModal: '新建年级组', clsGroupName: '组名', clsOptional: '（可选）', clsNoLeader: '暂不设组长', clsGroupNameRequired: '组名不能为空', clsGroupCreated: '年级组创建成功', clsSetLeaderModal: '设组长', clsRevokeLeader: '撤销组长', clsLeaderSet: '组长已设置', clsLeaderRevoked: '已撤销组长', clsAddPrepLeader: '添加备课组长', clsMemberRequired: '成员 *', clsChooseMember: '选择成员…', clsConfirm: '确定', clsMemberRequiredToast: '请选择成员', clsPrepLeaderSet: '已设置备课组长', clsAddSubjectTeacher: '添加任课老师', clsSubjectOptional: '科目（选填）', clsAdd: '添加', clsTeacherAdded: '已添加任课老师', clsTeacherUpdated: '班主任已更新', clsNoSubjectTeachers: '暂无任课老师', clsDone: '完成', clsRemoveConfirm: '确定移除任课老师「{name}」吗？', clsPrepRemoveConfirm: '确定移除备课组长「{name}」吗？', clsDeleteClassConfirm: '确定删除班级「{name}」吗？删除后不可恢复。', clsDeleteGroupConfirm: '确定删除年级组「{name}」吗？组内 {count} 个班级将移出该组（班级本身不删除）。', clsDeleted: '已删除', clsOperationFailed: '操作失败', clsGroupUpdated: '「{name}」年级组已更新', clsTeacherChanged: '「{name}」班主任已更新', clsNamePlaceholder: '如：高三 6 班', clsGradePlaceholder: '如：高三', clsGradYearPlaceholder: '如：2027，留空 = 未设置', clsArchiveHint: '设置毕业年份后，该班级将在对应学年开学时自动归档，平台内不再保留其数据。', clsCanvasTitle: '未重默名单', clsCanvasStamp: '重默', clsCanvasUnit: '人', clsCanvasPending: '待重默', clsCanvasGeneratedAt: '生成于', clsCanvasImageFailed: '图片生成失败',
    },
    'zh-TW': {
      appTitle: '英語教師教學工作台', dashboard: '工作台首頁',
      home: '工作台首頁', classes: '我的班級', lessons: '備課中心', schedule: '教學課表',
      students: '學生管理', assignments: '作業統計', dictations: '默寫管理', exams: '考試成績',
      todos: '待辦中心', ai: 'AI 教學助手', recycle: '回收站', settings: '設定', admin: '平台管理',
      logout: '登出', language: '介面語言', loading: '載入中', quota: '配額管理',
      dashLoading: '載入中…', dashTodaySchedule: '今日課表', dashLessonTodo: '備課中心待辦', dashRecentAssignments: '最近布置作業',
      dashNoSchedule: '今天沒有排課，去「教學課表」新增吧', dashNoLessonTodo: '備課中心沒有待辦，一切就緒 ✓', dashNoAssignments: '最近沒有布置作業',
      dashMarkDone: '標記完成', dashUnnamedLesson: '未命名教案', dashUnnamedAssignment: '未命名作業', dashWholeGrade: '全年段', dashSubmitted: '已交',
      clsLoading: '載入中…', clsLoadFailed: '載入失敗，請稍後重試', clsGroups: '年級組', clsGroupsCount: '年級組（{count}）', clsMyGroups: '我帶領的年級組', clsMyGroupsCount: '我帶領的年級組（{count}）', clsNewGroup: '新增年級組',
      clsNoGroups: '還沒有年級組。年級組長可協助管理本組班級的班主任設定。', clsTotal: '共 {count} 個班級', clsNewClass: '新增班級',
      clsGradeGroup: '年級組', clsUngrouped: '未分組', clsHeadTeacher: '班主任', clsUnassigned: '未分配', clsTeacherAdjust: '班主任由空間管理員或年級組長調整', clsPrepLeader: '備課組長', clsSetLeader: '設組長', clsLeader: '組長', clsGroupClasses: '組內 {count} 個班', clsNoGroupClasses: '（暫無班級）', clsImportHint: '也可以透過「設定 → 資料匯入」批量匯入班級與學生',
      clsSubjectTeacher: '任課', clsAddTeacher: '任課老師', clsRemoveTeacher: '移除任課老師', clsEdit: '編輯', clsDelete: '刪除', clsViewStudents: '查看學生',
      clsGraduated: '畢業 {year}', clsNotSet: '未設定年級/學年', clsGroupLabel: '年級組：', clsHeadTeacherLabel: '班主任：', clsStudents: '名學生',
      clsMyClasses: '我的班級（{count}）', clsOtherClasses: '其他班級（{count}）', clsNoClasses: '還沒有班級，點擊右上角「新增班級」開始建立', clsTrend: '班均分趨勢', clsDownload: '下載', clsGradArchive: '已畢業班級歸檔（{count}）', clsGradLoadFailed: '畢業歸檔載入失敗，請稍後重試', clsGradLoading: '載入中…', clsGradEmpty: '暫無畢業歸檔', clsClassName: '班級名', clsGradYear: '畢業年份', clsAcademicYear: '原學年', clsArchiveTime: '歸檔時間', clsAction: '操作', clsDownloadLoading: '下載中…', clsDownloadStarted: '畢業歸檔已開始下載', clsCreate: '建立', clsSave: '儲存', clsCancel: '取消', clsClassNameRequired: '班級名稱不能為空', clsGradYearInvalid: '畢業年份須為 2000–2100 的整數，或留空', clsSaved: '已儲存', clsCreated: '班級建立成功', clsNewGroupModal: '新增年級組', clsGroupName: '組名', clsOptional: '（可選）', clsNoLeader: '暫不設組長', clsGroupNameRequired: '組名不能為空', clsGroupCreated: '年級組建立成功', clsSetLeaderModal: '設組長', clsRevokeLeader: '撤銷組長', clsLeaderSet: '組長已設定', clsLeaderRevoked: '已撤銷組長', clsAddPrepLeader: '新增備課組長', clsMemberRequired: '成員 *', clsChooseMember: '選擇成員…', clsConfirm: '確定', clsMemberRequiredToast: '請選擇成員', clsPrepLeaderSet: '已設定備課組長', clsAddSubjectTeacher: '新增任課老師', clsSubjectOptional: '科目（選填）', clsAdd: '新增', clsTeacherAdded: '已新增任課老師', clsTeacherUpdated: '班主任已更新', clsNoSubjectTeachers: '暫無任課老師', clsDone: '完成', clsRemoveConfirm: '確定移除任課老師「{name}」嗎？', clsPrepRemoveConfirm: '確定移除備課組長「{name}」嗎？', clsDeleteClassConfirm: '確定刪除班級「{name}」嗎？刪除後不可恢復。', clsDeleteGroupConfirm: '確定刪除年級組「{name}」嗎？組內 {count} 個班級將移出該組（班級本身不刪除）。', clsDeleted: '已刪除', clsOperationFailed: '操作失敗', clsGroupUpdated: '「{name}」年級組已更新', clsTeacherChanged: '「{name}」班主任已更新', clsNamePlaceholder: '如：高三 6 班', clsGradePlaceholder: '如：高三', clsGradYearPlaceholder: '如：2027，留空 = 未設定', clsArchiveHint: '設定畢業年份後，該班級將在對應學年開學時自動歸檔，平台內不再保留其資料。', clsCanvasTitle: '待重默名單', clsCanvasStamp: '重默', clsCanvasUnit: '人', clsCanvasPending: '待重默', clsCanvasGeneratedAt: '產生於', clsCanvasImageFailed: '圖片產生失敗',
    },
    en: {
      appTitle: 'English Teacher Workbench', dashboard: 'Workbench Home',
      home: 'Workbench Home', classes: 'My Classes', lessons: 'Lesson Planning', schedule: 'Schedule',
      students: 'Students', assignments: 'Assignments', dictations: 'Dictations', exams: 'Exams',
      todos: 'Todos', ai: 'AI Assistant', recycle: 'Recycle Bin', settings: 'Settings', admin: 'Platform Admin',
      logout: 'Log out', language: 'Language', loading: 'Loading', quota: 'Quota',
      dashLoading: 'Loading…', dashTodaySchedule: "Today's Schedule", dashLessonTodo: 'Lesson Planning Tasks', dashRecentAssignments: 'Recent Assignments',
      dashNoSchedule: 'No classes scheduled today. Add one in Schedule.', dashNoLessonTodo: 'No lesson planning tasks. All set ✓', dashNoAssignments: 'No recent assignments',
      dashMarkDone: 'Mark complete', dashUnnamedLesson: 'Untitled lesson', dashUnnamedAssignment: 'Untitled assignment', dashWholeGrade: 'All grades', dashSubmitted: 'Submitted',
      clsLoading: 'Loading…', clsLoadFailed: 'Loading failed. Please try again.', clsGroups: 'Grade Groups', clsGroupsCount: 'Grade Groups ({count})', clsMyGroups: 'My Grade Groups', clsMyGroupsCount: 'My Grade Groups ({count})', clsNewGroup: 'New grade group',
      clsNoGroups: 'No grade groups yet. Grade group leaders can help manage class teacher assignments.', clsTotal: '{count} classes', clsNewClass: 'New class',
      clsGradeGroup: 'Grade group', clsUngrouped: 'Ungrouped', clsHeadTeacher: 'Class teacher', clsUnassigned: 'Unassigned', clsTeacherAdjust: 'Class teachers can be changed by space administrators or grade group leaders', clsPrepLeader: 'Lesson team leader', clsSetLeader: 'Set leader', clsLeader: 'Leader', clsGroupClasses: '{count} classes in group', clsNoGroupClasses: '(No classes)', clsImportHint: 'You can also bulk import classes and students via “Settings → Data import”',
      clsSubjectTeacher: 'Subject teachers', clsAddTeacher: 'Add teacher', clsRemoveTeacher: 'Remove subject teacher', clsEdit: 'Edit', clsDelete: 'Delete', clsViewStudents: 'View students',
      clsGraduated: 'Graduated {year}', clsNotSet: 'Grade/academic year not set', clsGroupLabel: 'Grade group: ', clsHeadTeacherLabel: 'Class teacher: ', clsStudents: ' students',
      clsMyClasses: 'My Classes ({count})', clsOtherClasses: 'Other Classes ({count})', clsNoClasses: 'No classes yet. Click “New class” above to create one', clsTrend: 'Class average trend', clsDownload: 'Download', clsGradArchive: 'Graduated class archive ({count})', clsGradLoadFailed: 'Failed to load graduation archive. Please try again.', clsGradLoading: 'Loading…', clsGradEmpty: 'No graduation archives', clsClassName: 'Class', clsGradYear: 'Graduation year', clsAcademicYear: 'Academic year', clsArchiveTime: 'Archived at', clsAction: 'Action', clsDownloadLoading: 'Downloading…', clsDownloadStarted: 'Graduation archive download started', clsCreate: 'Create', clsSave: 'Save', clsCancel: 'Cancel', clsClassNameRequired: 'Class name is required', clsGradYearInvalid: 'Graduation year must be an integer from 2000 to 2100, or blank', clsSaved: 'Saved', clsCreated: 'Class created', clsNewGroupModal: 'New grade group', clsGroupName: 'Group name', clsOptional: '(optional)', clsNoLeader: 'No leader', clsGroupNameRequired: 'Group name is required', clsGroupCreated: 'Grade group created', clsSetLeaderModal: 'Set leader', clsRevokeLeader: 'Remove leader', clsLeaderSet: 'Leader set', clsLeaderRevoked: 'Leader removed', clsAddPrepLeader: 'Add lesson team leader', clsMemberRequired: 'Member *', clsChooseMember: 'Choose a member…', clsConfirm: 'Confirm', clsMemberRequiredToast: 'Please choose a member', clsPrepLeaderSet: 'Lesson team leader set', clsAddSubjectTeacher: 'Add subject teacher', clsSubjectOptional: 'Subject (optional)', clsAdd: 'Add', clsTeacherAdded: 'Subject teacher added', clsTeacherUpdated: 'Class teacher updated', clsNoSubjectTeachers: 'No subject teachers', clsDone: 'Done', clsRemoveConfirm: 'Remove subject teacher “{name}”?', clsPrepRemoveConfirm: 'Remove lesson team leader “{name}”?', clsDeleteClassConfirm: 'Delete class “{name}”? This cannot be undone.', clsDeleteGroupConfirm: 'Delete grade group “{name}”? Its {count} classes will be ungrouped.', clsDeleted: 'Deleted', clsOperationFailed: 'Operation failed', clsGroupUpdated: 'Grade group for “{name}” updated', clsTeacherChanged: 'Class teacher for “{name}” updated', clsNamePlaceholder: 'e.g. Grade 12 Class 6', clsGradePlaceholder: 'e.g. Grade 12', clsGradYearPlaceholder: 'e.g. 2027, blank = not set', clsArchiveHint: 'After a graduation year is set, this class will be archived at the start of that academic year and its data will no longer remain on the platform.', clsCanvasTitle: 'Students pending retest', clsCanvasStamp: 'Retest', clsCanvasUnit: 'students', clsCanvasPending: 'pending retest', clsCanvasGeneratedAt: 'Generated at', clsCanvasImageFailed: 'Failed to generate image',
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
    format(key, values = {}, fallback) {
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        this.t(key, fallback)
      );
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
