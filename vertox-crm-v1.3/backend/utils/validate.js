// ===== Vertox CRM - shared input validation helpers =====
// Every controller builds up an `errors` object ({fieldName: 'message'})
// and calls sendValidationError() so the frontend can show the message
// under the exact field that failed, instead of a single generic toast.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-.\s]{6,20}$/;
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;

function isEmpty(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function validateRequired(value, label, errors, key) {
  if (isEmpty(value)) errors[key] = `${label} is required`;
}

function validateEmail(value, label, errors, key, required = false) {
  if (isEmpty(value)) { if (required) errors[key] = `${label} is required`; return; }
  if (!EMAIL_RE.test(String(value))) errors[key] = `${label} must be a valid email address`;
}

function validatePhone(value, label, errors, key, required = false) {
  if (isEmpty(value)) { if (required) errors[key] = `${label} is required`; return; }
  if (!PHONE_RE.test(String(value))) errors[key] = `${label} must be a valid phone number`;
}

function validateNumber(value, label, errors, key, required = false) {
  if (isEmpty(value)) { if (required) errors[key] = `${label} is required`; return; }
  if (isNaN(Number(value))) errors[key] = `${label} must be a number`;
}

function validateUrl(value, label, errors, key, required = false) {
  if (isEmpty(value)) { if (required) errors[key] = `${label} is required`; return; }
  if (!URL_RE.test(String(value))) errors[key] = `${label} must be a valid URL (starting with http:// or https://)`;
}

// Numeric validation that also enforces min/max/decimals from the field's
// advanced Config (set from the "Add Field" builder in Modules & Fields) —
// so a Config like {min:0, max:100, decimals:0} is actually enforced here,
// not just shown as a UI hint that the server ignores.
function validateNumberWithConfig(value, label, errors, key, required, config) {
  if (isEmpty(value)) { if (required) errors[key] = `${label} is required`; return; }
  const num = Number(value);
  if (isNaN(num)) { errors[key] = `${label} must be a number`; return; }
  const cfg = config || {};
  if (cfg.min !== undefined && cfg.min !== '' && num < Number(cfg.min)) errors[key] = `${label} must be at least ${cfg.min}`;
  else if (cfg.max !== undefined && cfg.max !== '' && num > Number(cfg.max)) errors[key] = `${label} must be at most ${cfg.max}`;
  else if (cfg.decimals !== undefined && cfg.decimals !== '' && Number(cfg.decimals) === 0 && !Number.isInteger(num)) errors[key] = `${label} must be a whole number`;
}

function validateDate(value, label, errors, key, required = false) {
  if (isEmpty(value)) { if (required) errors[key] = `${label} is required`; return; }
  if (isNaN(new Date(value).getTime())) errors[key] = `${label} must be a valid date`;
}

function validateMaxLength(value, label, errors, key, max) {
  if (isEmpty(value)) return;
  if (String(value).length > max) errors[key] = `${label} must be ${max} characters or fewer`;
}

// Validates a dynamic module record's `fields` object against the module's
// live ModuleFields definitions — this is what keeps records fully in sync
// with whatever fields a module currently has, including brand-new ones.
function validateDynamicFields(fieldDefs, fields) {
  const errors = {};
  const safeFields = fields || {};
  for (const f of fieldDefs) {
    const val = safeFields[f.FieldKey];
    const required = !!f.IsRequired;
    let cfg = f.Config;
    if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = {}; } }
    cfg = cfg || {};
    switch (f.FieldType) {
      case 'email': validateEmail(val, f.Label, errors, f.FieldKey, required); break;
      case 'phone': validatePhone(val, f.Label, errors, f.FieldKey, required); break;
      case 'url': validateUrl(val, f.Label, errors, f.FieldKey, required); break;
      case 'number':
      case 'decimal':
      case 'currency': validateNumberWithConfig(val, f.Label, errors, f.FieldKey, required, cfg); break;
      case 'date':
      case 'datetime': validateDate(val, f.Label, errors, f.FieldKey, required); break;
      case 'select':
      case 'multiselect': {
        // Edge cases specific to multiselect, stress-tested against odd
        // client payloads (not just the happy path of a clean array):
        //  - a stray non-array value sent to a multiselect field (e.g. a
        //    single string from a mis-wired form) is rejected outright
        //    rather than silently wrapped into a 1-item array
        //  - an array containing empty-string/whitespace-only entries is
        //    rejected instead of counting as a "selection"
        //  - duplicate selections in the same array are rejected (usually
        //    means the UI double-submitted checkboxes)
        //  - an unbounded/huge array is capped, so a malformed or abusive
        //    payload can't bloat FieldsJson with thousands of entries
        if (f.FieldType === 'multiselect' && !isEmpty(val) && !Array.isArray(val)) {
          errors[f.FieldKey] = `${f.Label} must be a list of selected options`;
          break;
        }
        if (required) validateRequired(val, f.Label, errors, f.FieldKey);
        if (!isEmpty(val)) {
          let opts = f.Options;
          if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch (e) { opts = null; } }
          const chosen = f.FieldType === 'multiselect' ? val : [val];

          if (f.FieldType === 'multiselect') {
            if (chosen.length > 50) { errors[f.FieldKey] = `${f.Label} allows at most 50 selections`; break; }
            const cleaned = chosen.map(v => (typeof v === 'string' ? v.trim() : v));
            if (cleaned.some(v => v === '' || v === null || v === undefined)) {
              errors[f.FieldKey] = `${f.Label} contains an empty selection`; break;
            }
            const uniqueCount = new Set(cleaned).size;
            if (uniqueCount !== cleaned.length) {
              errors[f.FieldKey] = `${f.Label} contains duplicate selections`; break;
            }
          }

          if (Array.isArray(opts) && opts.length > 0) {
            const bad = chosen.filter(v => !opts.includes(v));
            if (bad.length) errors[f.FieldKey] = `${f.Label} must be one of the configured options`;
          }
        }
        break;
      }
      case 'text':
      case 'textarea':
        if (required) validateRequired(val, f.Label, errors, f.FieldKey);
        validateMaxLength(val, f.Label, errors, f.FieldKey, cfg.maxLength || (f.FieldType === 'textarea' ? 4000 : 500));
        break;
      default:
        if (required) validateRequired(val, f.Label, errors, f.FieldKey);
    }
  }
  return errors;
}

function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

function sendValidationError(res, errors, message = 'Please fix the highlighted fields') {
  return res.status(422).json({ message, errors });
}

module.exports = {
  isEmpty,
  validateRequired,
  validateEmail,
  validatePhone,
  validateNumber,
  validateNumberWithConfig,
  validateUrl,
  validateDate,
  validateMaxLength,
  validateDynamicFields,
  hasErrors,
  sendValidationError
};
