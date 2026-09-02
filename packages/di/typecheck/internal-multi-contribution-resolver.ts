import { resolveMultiContribution } from '@fluojs/di/internal';

type Assert<Condition extends true> = Condition;
type ResolverOwner = Parameters<typeof resolveMultiContribution>[0];

export type MultiContributionResolverAcceptsStructuralOwners = Assert<object extends ResolverOwner ? true : false>;
