const crypto = require('crypto');
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

function normalizePhone(phoneNumber) {
  if (typeof phoneNumber !== 'string') {
    throw new Error('Phone number must be a string');
  }

  let cleaned = phoneNumber.trim();

  // If it already starts with +, strip non-digit chars after the +
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.slice(1).replace(/\D/g, '');
  } else {
    cleaned = cleaned.replace(/\D/g, '');

    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = '+' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }

  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    throw new Error(`Invalid phone number format: ${cleaned}`);
  }

  return cleaned;
}

async function sendVerificationCode(phoneNumber) {
  try {
    const normalizedPhone = normalizePhone(phoneNumber);
    await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: normalizedPhone, channel: 'sms' });
    return { success: true, phoneNumber: normalizedPhone };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function checkVerificationCode(phoneNumber, code) {
  try {
    const normalizedPhone = normalizePhone(phoneNumber);
    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: normalizedPhone, code });
    if (check.status === 'approved') {
      return { success: true, phoneNumber: normalizedPhone };
    }
    return { success: false, error: 'Invalid or expired code' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function computePhoneLookup(normalizedPhone) {
  return crypto.createHmac('sha256', process.env.PHONE_LOOKUP_KEY)
    .update(normalizedPhone)
    .digest('hex');
}

module.exports = { normalizePhone, sendVerificationCode, checkVerificationCode, computePhoneLookup };
