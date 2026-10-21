/**
 * 关卡名 / 玩家署名的基础内容限制。
 * 浏览器端只负责即时提示；真正兜底在 Supabase 的插入触发器里。
 */
window.WorkshopModeration = (() => {
  const WORDS = [
    // 辱骂与人身攻击
    '傻逼', '煞笔', '沙比', '操你妈', '草你妈', '你妈死了', '死全家',
    '婊子', '贱人', '杂种', '狗东西', '去死吧', '支那', '黑鬼', '尼哥',
    // 亲属称谓（含同类行为中常见的冒用称呼）
    '爸爸', '父亲', '妈妈', '母亲', '爹地', '妈咪',
    '爷爷', '奶奶', '外公', '外婆', '姥爷', '姥姥',
    '哥哥', '姐姐', '弟弟', '妹妹', '儿子', '女儿',
    '叔叔', '阿姨', '舅舅', '舅妈', '姑姑', '姑父', '姨妈', '姨父',
    '表哥', '表姐', '表弟', '表妹', '堂哥', '堂姐', '堂弟', '堂妹',
    '岳父', '岳母', '公公', '婆婆', '女婿', '儿媳', '亲戚',
    // 色情与未成年人相关内容
    '强奸', '轮奸', '迷奸', '恋童', '儿童色情', '幼女', '裸聊', '约炮',
    '嫖娼', '卖淫', '色情', '成人视频', '黄片',
    // 违法交易与危险行为
    '制毒', '贩毒', '冰毒', '海洛因', '炸弹制作', '造枪', '卖枪', '枪支交易',
    '恐怖袭击', '杀人教程', '买凶',
    // 诈骗、赌博和广告
    '博彩', '网赌', '赌博网站', '代开发票', '刷单', '兼职日结', '贷款秒批',
    '办证', '代孕', '卖肾', '器官买卖', '洗钱', '加微信', '加qq', '扫码返利',
  ];
  const URL_RE = /(?:https?:\/\/|www\.)/i;
  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  const PHONE_RE = /(?:^|\D)1[3-9]\d{9}(?:\D|$)/;
  const CONTACT_RE = /(?:微信|weixin|vx|v信|qq|扣扣)\s*[:：]?\s*[a-z0-9_-]{5,}/i;

  const normalize = (text) => String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_.·•*~|/\\]+/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');

  const check = (text) => {
    const raw = String(text || '').trim();
    const compact = normalize(raw);
    const word = WORDS.find((w) => compact.includes(normalize(w)));
    if (word) return { ok: false, reason: `包含违禁词「${word}」` };
    if (URL_RE.test(raw) || EMAIL_RE.test(raw)) {
      return { ok: false, reason: '不能包含网址或邮箱' };
    }
    if (PHONE_RE.test(raw) || CONTACT_RE.test(raw)) {
      return { ok: false, reason: '不能包含手机号或社交账号' };
    }
    return { ok: true };
  };

  return {
    words: WORDS.slice(),
    check,
    checkName: check,
    checkAuthor: check,
  };
})();
