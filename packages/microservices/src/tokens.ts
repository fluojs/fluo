import type { Token } from '@fluojs/core';

import type { Microservice, MicroserviceModuleOptions } from './types.js';

/** Compatibility injection token for the programmatic microservice facade. */
export const MICROSERVICE: Token<Microservice> = Symbol.for('konekti.microservices.service');
/** Injection token for the configured transport and runtime module options. */
export const MICROSERVICE_OPTIONS: Token<MicroserviceModuleOptions> = Symbol.for('konekti.microservices.options');
