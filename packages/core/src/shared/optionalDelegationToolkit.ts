type DelegationToolkitModule = typeof import('@metamask/delegation-toolkit');

let toolkitPromise: Promise<DelegationToolkitModule | null> | null = null;

async function loadToolkitModule(): Promise<DelegationToolkitModule | null> {
  if (!toolkitPromise) {
    toolkitPromise = import('@metamask/delegation-toolkit')
      .then(module => module)
      .catch(error => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[delegation] @metamask/delegation-toolkit not available:',
            error instanceof Error ? error.message : error,
          );
        }
        return null;
      });
  }
  return toolkitPromise;
}

export async function requireDelegationToolkit(options?: {
  feature?: string;
}): Promise<DelegationToolkitModule> {
  const module = await loadToolkitModule();
  if (!module) {
    const feature = options?.feature ?? 'Account abstraction features';
    throw new Error(
      `${feature} require '@metamask/delegation-toolkit'. Install the dependency or disable the feature in this deployment.`,
    );
  }
  return module;
}

export async function tryDelegationToolkit(): Promise<DelegationToolkitModule | null> {
  return await loadToolkitModule();
}

