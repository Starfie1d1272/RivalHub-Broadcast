import qualificationContract from '../../apps/companion/src/qualification/contract.json' with { type: 'json' };

// Update the repository-owned contract in a normal PR when the portable runtime is upgraded.
export const QUALIFICATION_NODE_VERSION = qualificationContract.nodeRuntimeVersion;
