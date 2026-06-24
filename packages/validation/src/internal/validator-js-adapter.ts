import validator from 'validator';

import type { DtoFieldValidationRule } from '@fluojs/core/request-pipeline';

export function runValidatorJs(rule: Extract<DtoFieldValidationRule, { kind: 'validatorjs' }>, value: unknown): boolean {
  if (rule.validator === 'latitude') {
    return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
  }

  if (rule.validator === 'longitude') {
    return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
  }

  if (typeof value !== 'string') {
    return false;
  }

  switch (rule.validator) {
    case 'alpha': return validator.isAlpha(value);
    case 'alphanumeric': return validator.isAlphanumeric(value);
    case 'ascii': return validator.isAscii(value);
    case 'base64': return validator.isBase64(value);
    case 'booleanString': return validator.isBoolean(value);
    case 'currency': return validator.isCurrency(value, rule.args?.[0] as validator.IsCurrencyOptions | undefined);
    case 'dataURI': return validator.isDataURI(value);
    case 'dateString': return validator.isISO8601(value);
    case 'decimal': return validator.isDecimal(value);
    case 'email': return validator.isEmail(value, rule.args?.[0] as validator.IsEmailOptions | undefined);
    case 'fqdn': return validator.isFQDN(value, rule.args?.[0] as validator.IsFQDNOptions | undefined);
    case 'hexColor': return validator.isHexColor(value);
    case 'hexadecimal': return validator.isHexadecimal(value);
    case 'ip': return validator.isIP(value, rule.args?.[0] as '4' | '6' | undefined);
    case 'isbn': return validator.isISBN(value, rule.args?.[0] as '10' | '13' | undefined);
    case 'issn': return validator.isISSN(value);
    case 'json': return validator.isJSON(value);
    case 'jwt': return validator.isJWT(value);
    case 'locale': return validator.isLocale(value);
    case 'lowercase': return validator.isLowercase(value);
    case 'magnetURI': return validator.isMagnetURI(value);
    case 'matches': return validator.matches(value, rule.args?.[0] as string, rule.args?.[1] as string | undefined);
    case 'mimeType': return validator.isMimeType(value);
    case 'mobilePhone': return validator.isMobilePhone(value, rule.args?.[0] as validator.MobilePhoneLocale | validator.MobilePhoneLocale[] | undefined);
    case 'mongoId': return validator.isMongoId(value);
    case 'numberString': return validator.isNumeric(value);
    case 'port': return validator.isPort(value);
    case 'postalCode': return validator.isPostalCode(value, (rule.args?.[0] as validator.PostalCodeLocale | 'any' | undefined) ?? 'any');
    case 'rgbColor': return validator.isRgbColor(value, rule.args?.[0] as boolean | undefined);
    case 'rfc3339': return validator.isRFC3339(value);
    case 'semVer': return validator.isSemVer(value);
    case 'uppercase': return validator.isUppercase(value);
    case 'url': return validator.isURL(value, rule.args?.[0] as validator.IsURLOptions | undefined);
    case 'uuid': return validator.isUUID(value, rule.args?.[0] as validator.UUIDVersion | undefined);
    case 'iso8601': return validator.isISO8601(value);
    case 'latLong': return validator.isLatLong(value);
    default: return false;
  }
}
