import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const domainPath = resolve(import.meta.dirname, '../references/domain.json');

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readJsonRecord = (path) => {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(value)) {
    throw new TypeError(`Expected a JSON object at ${path}.`);
  }
  return value;
};

const readStringArray = (record, key) => {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${key} must be an array of strings.`);
  }
  return value;
};

const unique = (values) => [...new Set(values)];

export const prepareScenario = (scenarioPath) => {
  const scenario = readJsonRecord(scenarioPath);
  const domain = readJsonRecord(domainPath);
  const intake = scenario.intake;
  if (!isRecord(intake)) {
    throw new TypeError('intake must be an object.');
  }

  const packages = unique(readStringArray(intake, 'packages'));
  const purposes = unique(readStringArray(intake, 'purposes'));
  if (packages.length === 0) {
    return {
      kind: 'rejected',
      result: {
        status: 'rejected',
        reason: 'missing_scope',
      },
    };
  }
  if (purposes.length === 0) {
    return {
      kind: 'rejected',
      result: {
        status: 'rejected',
        reason: 'missing_purpose',
      },
    };
  }

  const supportedPackages = new Set(readStringArray(domain, 'packages'));
  const unknownPackage = packages.find(
    (packageName) => !supportedPackages.has(packageName),
  );
  if (unknownPackage !== undefined) {
    return {
      kind: 'rejected',
      result: {
        status: 'rejected',
        reason: 'unknown_package',
        package: unknownPackage,
      },
    };
  }

  const purposeRoutes = domain.purposes;
  const reviewers = domain.reviewers;
  if (!isRecord(purposeRoutes) || !isRecord(reviewers)) {
    throw new TypeError('domain purpose and reviewer contracts are required.');
  }

  const selectedReviewers = unique(
    purposes.flatMap((purpose) => {
      const route = purposeRoutes[purpose];
      if (!Array.isArray(route) || route.some((item) => typeof item !== 'string')) {
        throw new TypeError(`Unsupported purpose: ${purpose}.`);
      }
      return route;
    }),
  );

  const invocations = packages.flatMap((packageName) =>
    selectedReviewers.map((reviewer) => {
      const contract = reviewers[reviewer];
      if (!isRecord(contract) || typeof contract.result_type !== 'string') {
        throw new TypeError(`Missing reviewer contract: ${reviewer}.`);
      }
      return {
        invocation_id: `package:${packageName}/reviewer:${reviewer}`,
        package: packageName,
        reviewer,
        expected_result_type: contract.result_type,
        status: 'expected',
      };
    }),
  );

  return {
    kind: 'ready',
    scenario,
    domain,
    scope: {
      mode: intake.scope_mode,
      packages,
      purposes,
    },
    invocations,
  };
};
