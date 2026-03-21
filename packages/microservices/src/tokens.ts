import type { Token } from '@konekti/core';

import type { Microservice, MicroserviceModuleOptions } from './types.js';

export const MICROSERVICE: Token<Microservice> = Symbol.for('konekti.microservices.service');
export const MICROSERVICE_OPTIONS: Token<MicroserviceModuleOptions> = Symbol.for('konekti.microservices.options');
