import { NotAcceptableException } from '../exceptions.js';

/**
 * Signals that response content negotiation rejected every available representation.
 */
export class ContentNegotiationNotAcceptableException extends NotAcceptableException {}
