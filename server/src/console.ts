// 管理控制台：GET / 返回的中文单页，内联 JS，无构建步骤。
// 注意：这里是 TS 模板字符串，页面里的 JS 不用反引号，避免嵌套冲突。

export const CONSOLE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>网吧管理后台</title>
<style>
*{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f2f3f5;color:#222}
header{background:#1a73e8;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
header h1{font-size:18px;margin:0} header .shop{font-size:13px;opacity:.9}
main{max-width:1080px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.tabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.tabs button{padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:20px;cursor:pointer;font-size:14px}
.tabs button.on{background:#1a73e8;color:#fff;border-color:#1a73e8}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}
th{color:#666;font-weight:600}
button{padding:6px 12px;border:1px solid #ddd;background:#fff;border-radius:6px;cursor:pointer;font-size:13px;margin:2px}
button.primary{background:#1a73e8;color:#fff;border-color:#1a73e8}
button.danger{color:#d93025;border-color:#f0b4b0}
input,select{padding:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;margin:2px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px}
.b-in_use{background:#e6f4ea;color:#137333}.b-locked{background:#fef7e0;color:#a50e0e}.b-offline{background:#f1f3f4;color:#5f6368}.b-paused{background:#e8f0fe;color:#1967d2}
#login{max-width:360px;margin:80px auto}
#login input{width:100%;margin:6px 0}
#login button{width:100%;padding:10px}
.hidden{display:none}
.ad-slot{border:2px dashed #f9ab00;background:#fef7e0;color:#7a5b00;text-align:center;padding:14px;border-radius:8px;margin-bottom:16px;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.pc{border:1px solid #e0e0e0;border-radius:8px;padding:12px}
.pc h3{margin:0 0 6px;font-size:16px}
.pc p{margin:4px 0;font-size:13px;color:#555}
.err{color:#d93025}.ok{color:#137333}
</style>
</head>
<body>
<header><h1>🖥️ 网吧管理后台</h1><span class="shop" id="shopName"></span></header>
<main>
  <!-- 广告位 1：顶部横幅（商业模式：软件免费，广告位赚钱；接广告时把下面 div 换成广告代码） -->
  <div class="ad-slot">广告位 · 顶部横幅 1080×90（待招商）</div>

  <div id="login" class="card">
    <h2>管理员登录</h2>
    <input id="pwd" type="password" placeholder="管理员密码" autocomplete="current-password">
    <button class="primary" onclick="doLogin()">登录</button>
    <p id="loginErr" class="err"></p>
  </div>

  <div id="app" class="hidden">
    <div class="tabs">
      <button data-tab="computers" class="on" onclick="showTab('computers')">电脑</button>
      <button data-tab="members" onclick="showTab('members')">会员</button>
      <button data-tab="pricing" onclick="showTab('pricing')">收费标准</button>
      <button data-tab="topups" onclick="showTab('topups')">充值记录</button>
      <button data-tab="rentals" onclick="showTab('rentals')">账单</button>
      <button data-tab="settings" onclick="showTab('settings')">设置</button>
      <button onclick="logout()" style="margin-left:auto">退出登录</button>
    </div>

    <div id="tab-computers" class="tab">
      <div class="card">
        <h3>电脑状态 <button onclick="loadComputers()">刷新</button></h3>
        <div id="pcList" class="grid"><p>加载中…</p></div>
      </div>
      <div class="card">
        <h3>游客预付开卡</h3>
        电脑 <input id="prePc" placeholder="PC01" size="8">
        时长 <input id="preMin" type="number" value="60" min="1" style="width:80px"> 分钟
        金额 <input id="preAmt" type="number" value="500" min="0" style="width:90px"> 分
        <button class="primary" onclick="prepaid()">开卡上机</button>
        <span id="preMsg"></span>
      </div>
    </div>

    <div id="tab-members" class="tab hidden">
      <div class="card">
        <h3>新建会员</h3>
        用户名 <input id="mUser" placeholder="zhangsan" size="12">
        密码 <input id="mPass" type="password" placeholder="密码" size="12">
        类型 <select id="mType"><option value="member">普通会员</option><option value="vip">VIP</option></select>
        初始余额（分） <input id="mBal" type="number" value="0" style="width:90px">
        电话 <input id="mPhone" placeholder="138…" size="12">
        <button class="primary" onclick="addMember()">新建</button>
        <span id="mMsg"></span>
      </div>
      <div class="card"><h3>会员列表</h3><div id="memberList">加载中…</div></div>
    </div>

    <div id="tab-pricing" class="tab hidden">
      <div class="card"><h3>收费标准（分/小时）</h3><div id="pricingList">加载中…</div>
      <p style="color:#666;font-size:13px">计费取第一条启用的标准；会员登录按余额扣费，余额耗尽自动锁定下机。</p></div>
    </div>

    <div id="tab-topups" class="tab hidden">
      <div class="card"><h3>充值记录</h3><div id="topupList">加载中…</div></div>
    </div>

    <div id="tab-rentals" class="tab hidden">
      <div class="card"><h3>账单（上机记录）</h3><div id="rentalList">加载中…</div></div>
    </div>

    <div id="tab-settings" class="tab hidden">
      <div class="card"><h3>设置</h3>
        网吧名 <input id="setShop" size="20"> <button class="primary" onclick="saveSettings()">保存</button>
        <span id="setMsg"></span>
        <p style="color:#666;font-size:13px">微信支付商户号/密钥、管理员密码在服务器 secrets 里改，不在这里填。</p>
      </div>
    </div>

    <!-- 广告位 2：底部横幅 -->
    <div class="ad-slot">广告位 · 底部横幅 1080×90（待招商）</div>
  </div>
</main>
<script>
var token = localStorage.getItem('bnet_admin_token') || '';
function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token}, opts.headers || {});
  return fetch(path, opts).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
}
function fmtMoney(c){ return (c/100).toFixed(2) + ' 元'; }
function fmtTime(s){ if(!s) return '-'; return new Date(s).toLocaleString(); }
function fmtDur(sec){ if(sec==null) return '-'; var h=Math.floor(sec/3600), m=Math.floor(sec%3600/60); return h>0 ? h+'小时'+m+'分' : m+'分'; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

function doLogin(){
  var pwd = document.getElementById('pwd').value;
  fetch('/api/admin/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: pwd})})
    .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||'登录失败'); return j; }); })
    .then(function(j){ token = j.token; localStorage.setItem('bnet_admin_token', token); enter(); })
    .catch(function(e){ document.getElementById('loginErr').textContent = e.message; });
}
function logout(){ token=''; localStorage.removeItem('bnet_admin_token'); location.reload(); }
function enter(){
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadComputers(); loadMembers(); loadPricing(); loadTopups(); loadRentals(); loadSettings();
  setInterval(function(){ if(!document.getElementById('tab-computers').classList.contains('hidden')) loadComputers(); }, 5000);
}
function showTab(name){
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.add('hidden'); });
  document.getElementById('tab-'+name).classList.remove('hidden');
  document.querySelectorAll('.tabs button[data-tab]').forEach(function(b){ b.classList.toggle('on', b.dataset.tab===name); });
  if(name==='computers') loadComputers();
  if(name==='members') loadMembers();
  if(name==='pricing') loadPricing();
  if(name==='topups') loadTopups();
  if(name==='rentals') loadRentals();
  if(name==='settings') loadSettings();
}

function loadComputers(){
  api('/api/admin/computers').then(function(j){
    document.getElementById('shopName').textContent = '';
    var html = '';
    if(!j.computers.length) html = '<p>还没有电脑。客户端连上 WebSocket（wss://本域名/ws?computerId=PC01）后会自动出现。</p>';
    j.computers.forEach(function(c){
      var live = c.live || {};
      var st = c.status;
      html += '<div class="pc"><h3>' + esc(c.id) + ' ' + esc(c.name||'') + ' <span class="badge b-' + st + '">' + ({in_use:'使用中',locked:'已锁定',offline:'离线',paused:'已暂停'}[st]||st) + '</span></h3>'
        + '<p>用户：' + esc(live.username || '-') + '</p>'
        + '<p>剩余：' + fmtDur(live.remainingSeconds) + ' · 在线：' + (live.online ? '是' : '否') + '</p>'
        + '<p>上次在线：' + fmtTime(c.last_seen) + '</p>'
        + '<button onclick="cmd(\\'' + esc(c.id) + '\\',\\'LOCK\\')">锁定</button>'
        + '<button onclick="cmd(\\'' + esc(c.id) + '\\',\\'LOGOUT\\')">下机结算</button>'
        + '<button onclick="cmd(\\'' + esc(c.id) + '\\',\\'MESSAGE\\')">发消息</button>'
        + '<button onclick="cmd(\\'' + esc(c.id) + '\\',\\'REFRESH\\')">刷新</button>'
        + '<button onclick="cmd(\\'' + esc(c.id) + '\\',\\'RESTART\\')">重启</button>'
        + '<button class="danger" onclick="cmd(\\'' + esc(c.id) + '\\',\\'SHUTDOWN\\')">关机</button>'
        + '</div>';
    });
    document.getElementById('pcList').innerHTML = html;
  }).catch(function(e){ document.getElementById('pcList').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
}
function cmd(pc, command){
  var message = undefined;
  if(command==='MESSAGE'){ message = prompt('发给 ' + pc + ' 的消息：'); if(message==null) return; }
  api('/api/admin/command', {method:'POST', body: JSON.stringify({computerId: pc, command: command, message: message})})
    .then(function(){ loadComputers(); })
    .catch(function(e){ alert(e.message); });
}
function prepaid(){
  var pc = document.getElementById('prePc').value.trim();
  var min = Number(document.getElementById('preMin').value);
  var amt = Number(document.getElementById('preAmt').value);
  api('/api/admin/rental', {method:'POST', body: JSON.stringify({computerId: pc, minutes: min, amountCents: amt})})
    .then(function(j){ document.getElementById('preMsg').textContent = '已开卡，到期 ' + fmtTime(j.expiresAt); document.getElementById('preMsg').className='ok'; loadComputers(); })
    .catch(function(e){ document.getElementById('preMsg').textContent = e.message; document.getElementById('preMsg').className='err'; });
}
function loadMembers(){
  api('/api/admin/members').then(function(j){
    var html = '<table><tr><th>ID</th><th>用户名</th><th>类型</th><th>余额</th><th>电话</th><th>创建时间</th><th>操作</th></tr>';
    j.members.forEach(function(m){
      html += '<tr><td>' + m.id + '</td><td>' + esc(m.username) + '</td><td>' + esc(m.type) + '</td><td>' + fmtMoney(m.balance_cents) + '</td><td>' + esc(m.phone||'') + '</td><td>' + fmtTime(m.created_at) + '</td>'
        + '<td><button onclick="topupMember(' + m.id + ')">充值</button> <button onclick="setType(' + m.id + ')">改类型</button></td></tr>';
    });
    document.getElementById('memberList').innerHTML = html + '</table>';
  }).catch(function(e){ document.getElementById('memberList').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
}
function addMember(){
  var body = {username: document.getElementById('mUser').value.trim(), password: document.getElementById('mPass').value,
    type: document.getElementById('mType').value, balanceCents: Number(document.getElementById('mBal').value||0),
    phone: document.getElementById('mPhone').value.trim()};
  api('/api/admin/members', {method:'POST', body: JSON.stringify(body)})
    .then(function(){ document.getElementById('mMsg').textContent='已新建'; document.getElementById('mMsg').className='ok'; loadMembers(); })
    .catch(function(e){ document.getElementById('mMsg').textContent=e.message; document.getElementById('mMsg').className='err'; });
}
function topupMember(id){
  var v = prompt('给会员 #' + id + ' 充值多少分？（100 分 = 1 元）');
  if(v==null) return;
  // 读当前余额再累加
  api('/api/admin/members').then(function(j){
    var m = j.members.find(function(x){ return x.id===id; });
    if(!m) return;
    return api('/api/admin/members', {method:'POST', body: JSON.stringify({id: id, balanceCents: m.balance_cents + Number(v)})});
  }).then(function(){ loadMembers(); }).catch(function(e){ alert(e.message); });
}
function setType(id){
  var t = prompt('新类型（member / vip）：', 'vip');
  if(!t) return;
  api('/api/admin/members', {method:'POST', body: JSON.stringify({id: id, type: t})}).then(loadMembers).catch(function(e){ alert(e.message); });
}
function loadPricing(){
  api('/api/admin/pricing').then(function(j){
    var html = '<table><tr><th>ID</th><th>名称</th><th>标准价</th><th>会员价</th><th>VIP价</th><th>启用</th></tr>';
    j.pricing.forEach(function(p){
      html += '<tr><td>' + p.id + '</td><td>' + esc(p.name) + '</td><td>' + fmtMoney(p.price_per_hour_cents) + '/时</td><td>' + fmtMoney(p.member_price_cents) + '/时</td><td>' + fmtMoney(p.vip_price_cents) + '/时</td><td>' + (p.enabled?'是':'否') + '</td></tr>';
    });
    document.getElementById('pricingList').innerHTML = html + '</table>';
  }).catch(function(e){ document.getElementById('pricingList').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
}
function loadTopups(){
  api('/api/admin/topups').then(function(j){
    var html = '<table><tr><th>订单号</th><th>用户</th><th>电脑</th><th>金额</th><th>状态</th><th>创建时间</th><th>到账时间</th></tr>';
    j.topups.forEach(function(t){
      html += '<tr><td>' + esc(t.order_no) + '</td><td>' + esc(t.username||'-') + '</td><td>' + esc(t.computer_id||'') + '</td><td>' + fmtMoney(t.amount_cents) + '</td><td>' + esc(t.status) + '</td><td>' + fmtTime(t.created_at) + '</td><td>' + fmtTime(t.paid_at) + '</td></tr>';
    });
    document.getElementById('topupList').innerHTML = html + '</table>';
  }).catch(function(e){ document.getElementById('topupList').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
}
function loadRentals(){
  api('/api/admin/rentals').then(function(j){
    var html = '<table><tr><th>ID</th><th>用户</th><th>电脑</th><th>开始</th><th>结束</th><th>金额</th><th>状态</th></tr>';
    j.rentals.forEach(function(r){
      html += '<tr><td>' + r.id + '</td><td>' + esc(r.username||'游客') + '</td><td>' + esc(r.computer_id) + '</td><td>' + fmtTime(r.start_time) + '</td><td>' + fmtTime(r.end_time) + '</td><td>' + fmtMoney(r.amount_cents) + '</td><td>' + esc(r.status) + '</td></tr>';
    });
    document.getElementById('rentalList').innerHTML = html + '</table>';
  }).catch(function(e){ document.getElementById('rentalList').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
}
function loadSettings(){
  api('/api/admin/settings').then(function(j){
    document.getElementById('setShop').value = j.settings.shop_name || '';
    document.getElementById('shopName').textContent = j.settings.shop_name || '';
  }).catch(function(){});
}
function saveSettings(){
  api('/api/admin/settings', {method:'POST', body: JSON.stringify({key:'shop_name', value: document.getElementById('setShop').value})})
    .then(function(){ document.getElementById('setMsg').textContent='已保存'; document.getElementById('setMsg').className='ok'; loadSettings(); })
    .catch(function(e){ document.getElementById('setMsg').textContent=e.message; document.getElementById('setMsg').className='err'; });
}
if(token){ enter(); }
document.getElementById('pwd').addEventListener('keydown', function(e){ if(e.key==='Enter') doLogin(); });
</script>
</body>
</html>`;
