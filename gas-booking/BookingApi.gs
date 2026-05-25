/**
 * ============================================================
 * 江田畜産 予約システム — GAS バックエンド
 * ============================================================
 *
 * エンドポイント:
 *   GET  ?action=ping              - ヘルスチェック
 *   GET  ?action=available_slots   - 空き枠取得 (date=YYYY-MM-DD, tz=Asia/Tokyo)
 *   POST ?action=create_booking    - 予約作成
 *
 * セットアップ:
 *   1. Apps Script プロジェクト作成 → このコード貼り付け
 *   2. プロジェクト設定 → スクリプト プロパティ:
 *      - CALENDAR_ID               : tomoki@eda-livestock.com (Tomのカレンダー)
 *      - NOTIFICATION_EMAIL        : tomoki@eda-livestock.com
 *      - ALLOWED_ORIGINS           : https://edywagyu.github.io,https://eda-livestock.com
 *   3. デプロイ → ウェブアプリ → 実行ユーザー: 自分 → アクセス: 全員
 *   4. デプロイ URL をフロント側 booking.html の BOOKING_API_URL に設定
 */

const PROPS = PropertiesService.getScriptProperties();
const CALENDAR_ID = PROPS.getProperty('CALENDAR_ID') || '';
const NOTIFICATION_EMAIL = PROPS.getProperty('NOTIFICATION_EMAIL') || 'tomoki@eda-livestock.com';

// 最小リードタイム：3 日（72 時間）後以降のみ予約可
const MIN_LEAD_TIME_HOURS = 72;

/**
 * Tom のカレンダーを取得。Script Property に CALENDAR_ID があれば優先。
 * なければ getDefaultCalendar()（= 実行ユーザー tomoki@eda-livestock.com の primary）。
 */
function getTomCalendar_() {
  if (CALENDAR_ID) {
    var cal = CalendarApp.getCalendarById(CALENDAR_ID);
    if (cal) return cal;
  }
  return CalendarApp.getDefaultCalendar();
}

function doGet(e) {
  const action = (e.parameter.action || '').trim();
  let result;
  try {
    switch (action) {
      case 'ping':
        result = { ok: true, ts: new Date().toISOString() };
        break;
      case 'available_slots':
        result = getAvailableSlots(e.parameter);
        break;
      default:
        result = { error: 'Unknown action', action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return jsonResponse_(result);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  const action = body.action || (e.parameter && e.parameter.action) || '';
  let result;
  try {
    switch (action) {
      case 'create_booking':
        result = createBooking(body);
        break;
      default:
        result = { error: 'Unknown action', action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return jsonResponse_(result);
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   空き枠取得
   ============================================================ */

function getAvailableSlots(params) {
  const dateStr = params.date;
  const visitorTz = params.tz || 'Asia/Tokyo';
  const buyerType = params.type || 'domestic';

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { error: 'date parameter required (YYYY-MM-DD)' };
  }

  // Tom 指定 (2026-05-24): 国内/海外問わず JST 6:00 – 24:00 を開放
  // 国内バイヤーも早朝/深夜にコールイン可、海外バイヤーは時差を気にせず予約可能
  var startHourJST = 6;
  var endHourJST = 24;

  var dayStart = new Date(dateStr + 'T00:00:00+09:00');
  var dayEnd = new Date(dateStr + 'T23:59:59+09:00');

  var cal = getTomCalendar_();

  var events = cal.getEvents(dayStart, dayEnd);
  var busyRanges = events.map(function(ev) {
    return {
      start: ev.getStartTime().getTime(),
      end: ev.getEndTime().getTime()
    };
  });

  var minBookingTime = Date.now() + MIN_LEAD_TIME_HOURS * 60 * 60 * 1000;

  var slots = [];
  for (var h = startHourJST; h < endHourJST; h++) {
    var slotStartJST = new Date(dateStr + 'T' + pad_(h) + ':00:00+09:00');
    var slotEndJST = new Date(slotStartJST.getTime() + 60 * 60 * 1000);

    // 3日後以降のみ予約可
    if (slotStartJST.getTime() < minBookingTime) continue;

    var conflict = busyRanges.some(function(b) {
      return slotStartJST.getTime() < b.end && slotEndJST.getTime() > b.start;
    });
    if (conflict) continue;

    // 訪問者ローカル時刻のラベル生成（NY/LA/Madrid 等）
    var localLabel = formatInTz_(slotStartJST, visitorTz) + ' – ' +
                     formatInTz_(slotEndJST, visitorTz);

    slots.push({
      start_utc: slotStartJST.toISOString(),
      end_utc: slotEndJST.toISOString(),
      hour_jst: h,
      label_jst: pad_(h) + ':00 – ' + pad_(h + 1) + ':00 JST',
      label_local: localLabel,
      tz_local: visitorTz
    });
  }

  return {
    date: dateStr,
    buyer_type: buyerType,
    visitor_tz: visitorTz,
    calendar_email: cal.getId(),
    slots: slots
  };
}

/**
 * 指定タイムゾーンで時刻を HH:mm 形式に整形（NY なら "21:00"）。
 */
function formatInTz_(date, tz) {
  try {
    return Utilities.formatDate(date, tz, 'HH:mm');
  } catch (err) {
    return Utilities.formatDate(date, 'Asia/Tokyo', 'HH:mm');
  }
}

function pad_(n) {
  return n < 10 ? '0' + n : '' + n;
}

/* ============================================================
   予約作成
   ============================================================ */

function createBooking(body) {
  var required = ['start_utc', 'name', 'email', 'company'];
  for (var i = 0; i < required.length; i++) {
    if (!body[required[i]]) {
      return { error: 'Missing field: ' + required[i] };
    }
  }

  var startTime = new Date(body.start_utc);
  var endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

  var minBookingTime = Date.now() + MIN_LEAD_TIME_HOURS * 60 * 60 * 1000;
  if (startTime.getTime() < minBookingTime) {
    return { error: 'Bookings must be at least 3 days in advance / 予約は3日後以降の日時のみ受け付けています' };
  }

  var cal = getTomCalendar_();

  var existing = cal.getEvents(startTime, endTime);
  if (existing.length > 0) {
    return { error: 'This time slot is no longer available. Please choose another.' };
  }

  var buyerType = body.buyer_type || 'domestic';
  var titlePrefix = buyerType === 'domestic' ? '【国内】' : '【海外】';
  var title = titlePrefix + 'アポイント: ' + body.company + ' / ' + body.name;

  var desc = [
    '━━━ Booking Details ━━━',
    '',
    'Name: ' + body.name,
    'Company: ' + body.company,
    'Title: ' + (body.title || '—'),
    'Email: ' + body.email,
    'Phone/WhatsApp: ' + (body.phone || '—'),
    'Country: ' + (body.country || '—'),
    'City: ' + (body.city || '—'),
    'Website: ' + (body.website || '—'),
    'Business Type: ' + (body.business_type || '—'),
    'Language: ' + (body.language || '—'),
    'Buyer Type: ' + buyerType,
    '',
    '━━━ Agenda / Message ━━━',
    body.message || '(No message)',
    '',
    '━━━ System Info ━━━',
    'Visitor Timezone: ' + (body.visitor_tz || '—'),
    'Booked at: ' + new Date().toISOString()
  ].join('\n');

  var event = cal.createEvent(title, startTime, endTime, {
    description: desc,
    guests: body.email,
    sendInvites: true
  });

  event.setColor(buyerType === 'domestic'
    ? CalendarApp.EventColor.CYAN
    : CalendarApp.EventColor.BANANA);

  sendNotificationEmail_(body, startTime, endTime, buyerType);
  sendConfirmationEmail_(body, startTime, endTime, buyerType);

  return {
    ok: true,
    event_id: event.getId(),
    start: startTime.toISOString(),
    end: endTime.toISOString()
  };
}

/* ============================================================
   通知メール
   ============================================================ */

function sendNotificationEmail_(body, start, end, buyerType) {
  var jstStart = formatJST_(start);
  var jstEnd = formatJST_(end);
  var typeLabel = buyerType === 'domestic' ? '国内' : '海外';

  var subject = '【' + typeLabel + '予約】' + body.company + ' / ' + body.name + ' — ' + jstStart;

  var html = [
    '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">',
    '<div style="background:#0F3D2E;color:#D4A93B;padding:24px 32px;">',
    '<h2 style="margin:0;font-size:18px;">新規アポイント予約</h2>',
    '</div>',
    '<div style="padding:32px;background:#FAF7F0;">',
    '<table style="width:100%;border-collapse:collapse;font-size:14px;">',
    '<tr><td style="padding:8px 12px;font-weight:bold;width:120px;">日時</td>',
    '<td style="padding:8px 12px;">' + jstStart + ' – ' + jstEnd + '</td></tr>',
    '<tr><td style="padding:8px 12px;font-weight:bold;">タイプ</td>',
    '<td style="padding:8px 12px;">' + typeLabel + '</td></tr>',
    '<tr><td style="padding:8px 12px;font-weight:bold;">会社名</td>',
    '<td style="padding:8px 12px;">' + body.company + '</td></tr>',
    '<tr><td style="padding:8px 12px;font-weight:bold;">氏名</td>',
    '<td style="padding:8px 12px;">' + body.name + '</td></tr>',
    '<tr><td style="padding:8px 12px;font-weight:bold;">役職</td>',
    '<td style="padding:8px 12px;">' + (body.title || '—') + '</td></tr>',
    '<tr><td style="padding:8px 12px;font-weight:bold;">Email</td>',
    '<td style="padding:8px 12px;"><a href="mailto:' + body.email + '">' + body.email + '</a></td></tr>',
    '<tr><td style="padding:8px 12px;font-weight:bold;">Phone/WA</td>',
    '<td style="padding:8px 12px;">' + (body.phone || '—') + '</td></tr>',
    '<tr><td style="padding:8px 12px;font-weight:bold;">国</td>',
    '<td style="padding:8px 12px;">' + (body.country || '—') + '</td></tr>',
    '<tr><td style="padding:8px 12px;font-weight:bold;">業種</td>',
    '<td style="padding:8px 12px;">' + (body.business_type || '—') + '</td></tr>',
    '</table>',
    body.message ? '<div style="margin-top:24px;padding:16px;background:white;border-left:3px solid #D4A93B;"><strong>Message:</strong><br/>' + body.message.replace(/\n/g, '<br/>') + '</div>' : '',
    '</div>',
    '</div>'
  ].join('');

  MailApp.sendEmail({
    to: NOTIFICATION_EMAIL,
    subject: subject,
    htmlBody: html
  });
}

function sendConfirmationEmail_(body, start, end, buyerType) {
  var isJP = buyerType === 'domestic';
  var jstLabel = formatJST_(start) + ' – ' + formatJST_(end);

  var subject = isJP
    ? '【江田畜産】アポイント予約完了のお知らせ'
    : 'Booking Confirmed — EDA Livestock';

  var html = [
    '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">',
    '<div style="background:#0F3D2E;color:white;padding:32px;text-align:center;">',
    '<h1 style="margin:0;font-size:22px;color:#D4A93B;">',
    isJP ? 'ご予約ありがとうございます' : 'Booking Confirmed',
    '</h1>',
    '<p style="margin:8px 0 0;font-size:14px;opacity:0.8;">EDA Livestock Co., Ltd.</p>',
    '</div>',
    '<div style="padding:32px;background:#FAF7F0;">',
    '<p style="font-size:15px;margin:0 0 24px;">',
    isJP
      ? body.name + ' 様<br/><br/>以下の日程でお打ち合わせを承りました。Google カレンダーの招待も送信しておりますのでご確認ください。'
      : 'Dear ' + body.name + ',<br/><br/>Your meeting has been scheduled. You will also receive a Google Calendar invitation.',
    '</p>',
    '<div style="background:white;padding:24px;border-left:4px solid #D4A93B;margin:24px 0;">',
    '<p style="margin:0;font-size:14px;"><strong>',
    isJP ? '日時:' : 'Date & Time:',
    '</strong> ' + jstLabel + '</p>',
    '<p style="margin:8px 0 0;font-size:14px;"><strong>',
    isJP ? '形式:' : 'Format:',
    '</strong> ',
    isJP ? 'オンライン (Zoom/Google Meet) ※リンクは別途ご案内します' : 'Online meeting — link will follow',
    '</p>',
    '</div>',
    '<p style="font-size:13px;color:#5C5C5C;margin:24px 0 0;">',
    isJP
      ? 'ご不明点がございましたら backoffice@eda-livestock.com までお気軽にご連絡ください。'
      : 'If you have any questions, please contact us at backoffice@eda-livestock.com.',
    '</p>',
    '</div>',
    '<div style="background:#0F3D2E;padding:16px;text-align:center;">',
    '<p style="margin:0;font-size:12px;color:rgba(255,255,255,0.5);">江田畜産株式会社 | Eda Livestock Co., Ltd.</p>',
    '</div>',
    '</div>'
  ].join('');

  MailApp.sendEmail({
    to: body.email,
    subject: subject,
    htmlBody: html,
    replyTo: NOTIFICATION_EMAIL,
    name: '江田畜産 / EDA Livestock'
  });
}

function formatJST_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd (EEE) HH:mm');
}
