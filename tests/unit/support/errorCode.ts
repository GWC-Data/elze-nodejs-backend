function errorCode(work: () => unknown): string | undefined {
  try {
    work();
  } catch (err: any) {
    return err.code ?? err.message;
  }
  return undefined;
}

async function rejectionCode(work: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await work();
  } catch (err: any) {
    return err.code ?? err.message;
  }
  return undefined;
}

export { errorCode, rejectionCode };
