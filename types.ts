export type BatchQueryResponse = {
  batch: {
    block_height: number,
    responses: {
      id: string,
      contract: {
        address: string,
        code_hash: string
      },
      response: {
        response: string
      }
    }[],
  }
}

export type Results = {
  start?: number,
  lastUpdate?: number,
  contractsIndex: number,
  totalAttempts: number,
  successfulLiquidations: number,
  failedLiquidations: number,
  queryLength: number,
  txHash: string | undefined,
  contracts: {
    address: string,
    code_hash: string,
    vault_ids: number[],
    vaults_to_skip: number[],
  }[],
}
