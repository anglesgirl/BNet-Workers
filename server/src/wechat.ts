// 微信支付 v2（NATIVE 扫码支付）。
// 签名算法照搬 BNet Cafe 原版 WeChatPayHelper.cs：
//   参数按 ASCII 键排序，跳过空值和 sign 键，k=v 用 & 连接，
//   末尾拼 &key=API_KEY，MD5 后转大写。
// 区别：原版跑在局域网服务器上、收不到微信回调，只能轮询查单；
// 本服务端跑在 Cloudflare Workers 上有公网地址，notify_url 直接收回调验签，
// 轮询查单只当备用。

import { md5 } from './md5';

export const UNIFIED_ORDER_URL = 'https://api.mch.weixin.qq.com/pay/unifiedorder';
export const ORDER_QUERY_URL = 'https://api.mch.weixin.qq.com/pay/orderquery';

export function generateNonceStr(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += chars[b % chars.length];
  return s;
}

/** 商户订单号：BN + yyyyMMddHHmmss + 6 位随机数字（最长 32 字符），与原版格式一致。 */
export function generateOutTradeNo(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const rnd = String(Math.floor(100000 + Math.random() * 900000));
  return 'BN' + ts + rnd;
}

/** 微信支付 v2 MD5 签名：排序 → k=v&… → &key=API_KEY → MD5 → 大写。 */
export function sign(params: Record<string, string>, apiKey: string): string {
  const stringA = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== '' && params[k] != null)
    .sort() // 默认按 UTF-16 码元排序；微信字段全是 ASCII，与原版 StringComparer.Ordinal 一致
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return md5(`${stringA}&key=${apiKey}`).toUpperCase();
}

/** 组装 <xml>…</xml> 请求体，值包 CDATA（与原版 ToXml 一致）。 */
export function toXml(params: Record<string, string>): string {
  let xml = '<xml>';
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v == null) continue;
    xml += `<${k}><![CDATA[${v}]]></${k}>`;
  }
  return xml + '</xml>';
}

/** 解析微信 <xml> 响应/回调为扁平字典（与原版 ParseXml 一致）。 */
export function parseXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!xml) return result;
  const re = /<([a-zA-Z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    result[m[1]] = m[2] !== undefined ? m[2] : (m[3] ?? '');
  }
  return result;
}

async function postXml(url: string, xml: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: xml,
  });
  return await res.text();
}

export interface WechatConfig {
  appId: string;
  mchId: string;
  apiKey: string;
}

/** 统一下单（NATIVE）。成功返回 code_url（付款码内容，客户端画成二维码）。失败抛错。 */
export async function createNativeOrder(
  cfg: WechatConfig,
  body: string,
  outTradeNo: string,
  totalFeeFen: number,
  notifyUrl: string,
  clientIp = '127.0.0.1',
): Promise<string> {
  const params: Record<string, string> = {
    appid: cfg.appId,
    mch_id: cfg.mchId,
    nonce_str: generateNonceStr(),
    body,
    out_trade_no: outTradeNo,
    total_fee: String(totalFeeFen),
    spbill_create_ip: clientIp,
    notify_url: notifyUrl,
    trade_type: 'NATIVE',
  };
  params.sign = sign(params, cfg.apiKey);
  const result = parseXml(await postXml(UNIFIED_ORDER_URL, toXml(params)));
  if (result.return_code !== 'SUCCESS') {
    throw new Error(`WeChat unifiedorder failed: ${result.return_msg ?? ''}`);
  }
  if (result.result_code !== 'SUCCESS') {
    throw new Error(`WeChat unifiedorder error: ${result.err_code ?? ''} ${result.err_code_des ?? ''}`);
  }
  if (!result.code_url) throw new Error('WeChat unifiedorder returned no code_url.');
  return result.code_url;
}

/** 查单。返回 trade_state：SUCCESS / NOTPAY / USERPAYING / CLOSED / REVOKED / PAYERROR，异常返回 ''。 */
export async function queryOrderTradeState(cfg: WechatConfig, outTradeNo: string): Promise<string> {
  const params: Record<string, string> = {
    appid: cfg.appId,
    mch_id: cfg.mchId,
    nonce_str: generateNonceStr(),
    out_trade_no: outTradeNo,
  };
  params.sign = sign(params, cfg.apiKey);
  try {
    const result = parseXml(await postXml(ORDER_QUERY_URL, toXml(params)));
    if (result.return_code !== 'SUCCESS' || result.result_code !== 'SUCCESS') return '';
    return result.trade_state ?? '';
  } catch {
    return '';
  }
}

/** 验签微信回调：sign 字段与按其余字段重算的签名比对。 */
export function verifyNotifySign(params: Record<string, string>, apiKey: string): boolean {
  const received = params.sign;
  if (!received) return false;
  return sign(params, apiKey) === received.toUpperCase();
}

/** 回调成功应答 XML。 */
export function notifySuccessXml(): string {
  return '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>';
}

/** 回调失败应答 XML。 */
export function notifyFailXml(msg: string): string {
  return `<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[${msg}]]></return_msg></xml>`;
}
