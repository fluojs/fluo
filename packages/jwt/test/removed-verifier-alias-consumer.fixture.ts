import { DefaultJwtVerifier } from '@fluojs/jwt';

const verifier = new DefaultJwtVerifier({ algorithms: ['HS256'], secret: 'secret' });

void verifier.verifyAccessTokenWithOverrides('token');
