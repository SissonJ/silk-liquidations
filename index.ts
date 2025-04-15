import * as fs from 'fs';
import { MsgExecuteContract, SecretNetworkClient, TxResponse, Wallet } from 'secretjs';
import {BatchQueryResponse, Results} from './types';
import { config } from 'dotenv';

config();

const CONSTANTS = {
  // Time constants (in milliseconds)
  STATUS_REPORT_INTERVAL: 7_200_000, // 2 hours
  INITIAL_REPORT_THRESHOLD: 15_000,   // 15 seconds
  ATTEMPT_COOLDOWN: 30_000,          // 30 seconds
  THREE_SECONDS: 3_000,          // THREE seconds 
  ONE_SECOND: 1_000,          // one second 
  ONE_HOUR: 3_600_000,          // one hour
  
  // Pagination
  PAGE_SIZE: 10,
  
  // Transaction settings
  GAS_LIMIT: 1_500_000,
  GAS_LIMIT_WITH_STABILITY_POOL: 2_500_000,
  FEE_DENOM: 'uscrt',
  
  // Time format settings
  TIME_ZONE: 'America/Chicago',
  DATE_FORMAT: {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }
} as const;

if (!process.env.LCD_URL_0 
    || !process.env.CHAIN_ID 
    || !process.env.ARB_V4 
    || !process.env.ARB_V4_ADDRESS 
    || !process.env.ENCRYPTION_SEED
    || !process.env.BATCH_QUERY_CONTRACT
    || !process.env.BATCH_QUERY_HASH
) {
  throw new Error("Missing environment variables");
}

const client = new SecretNetworkClient({
  url: process.env.LCD_URL_0!,
  chainId: process.env.CHAIN_ID!,
  wallet: new Wallet(process.env.ARB_V4!),
  walletAddress: process.env.ARB_V4_ADDRESS!,
  encryptionSeed: Uint8Array.from(process.env.ENCRYPTION_SEED!.split(',').map(Number)),
});

const encodeJsonToB64 = (toEncode:any) : string => Buffer.from(JSON.stringify(toEncode), 'utf8').toString('base64');

const decodeB64ToJson = (encodedData: string) => JSON.parse(Buffer.from(encodedData, 'base64').toString('utf8'));

const getCentralTime = (date: Date): string => {
  return date.toLocaleString(
    'en-US', 
    CONSTANTS.DATE_FORMAT
  ).replace(
    /(\d+)\/(\d+)\/(\d+)/, 
    '$3-$1-$2'
  );
};

const logger = {
  error: (msg: string, time: Date, error?: any) => {
    console.error(`[${getCentralTime(time)} ERROR] ${msg}`, error);
  },
  info: (msg: string, time: Date) => {
    console.log(`[${getCentralTime(time)} INFO] ${msg}`);
  }
};

async function main() {
  if (!fs.existsSync('./results.txt')) {
    throw new Error("results.txt file not found");
  }
  let isUsingStabilityPool = process.env.IS_USING_STABILITY_POOL === 'true';

  const resultsUnparsed = fs.readFileSync('./results.txt', 'utf-8');
  let results: Results = JSON.parse(resultsUnparsed);

  const now = new Date();

  const index = results.contractsIndex ?? 0;
  if(results.contractsIndex === undefined) {
    results.contractsIndex = 0;
  } else if (index + 1 === results.contracts.length) {
    results.contractsIndex = 0;
  } else {
    results.contractsIndex += 1;
  }

 if (results.start === undefined ||  now.getTime() - (results.lastUpdate ?? 0) > CONSTANTS.ONE_HOUR * 2) {
   if(results.start === undefined) {
     results.start = now.getTime();
   }
    const queryLength = results.queryLength.reduce((acc, curr) => acc + curr, 0) / results.queryLength.length;
    results.lastUpdate = now.getTime();
    logger.info(
      `Bot running for ${Math.floor((now.getTime() - results.start) / CONSTANTS.ONE_HOUR)} hours` +
      `  Total Attempts: ${results.totalAttempts}` +
      `  Successful: ${results.successfulLiquidations}` +
      `  Failed: ${results.failedLiquidations}` +
      `  Queries Failed: ${results.queryErrors} ` +
      `  Average Query Length: ${queryLength.toFixed(3)}`,
      now
    );
    results.queryErrors = 0; // reset query errors after logging
  }
  const vaultContract = results.contracts[index];

  const queryMsg = {
    batch: {
      queries: [ ...vaultContract.vault_ids.map((vaultId) => ({
        id: encodeJsonToB64(`${vaultId}`),
        contract: {
          address: vaultContract.address,
          code_hash: vaultContract.code_hash,
        },
        query: encodeJsonToB64({
          liquidatable_positions:{
            vault_id:String(vaultId)
          }
        }),
      })),
      ] as any[],
    }
  };

  if(isUsingStabilityPool) {
    queryMsg.batch.queries.push(...[
      {
        id: encodeJsonToB64('user_position'),
        contract: {
          address: process.env.MONEY_MARKET_ADDRESS,
          code_hash: process.env.MONEY_MARKET_CODE_HASH,
        },
        query: encodeJsonToB64({ 
          user_position: { 
            authentication: { 
              permit: JSON.parse(
                process.env.SHADE_MASTER_PERMIT!
              ) 
            } 
          } 
        }),
      },
      {
        id: encodeJsonToB64('oracle'),
        contract: {
          address: process.env.ORACLE_ADDRESS,
          code_hash: process.env.ORACLE_CODE_HASH,
        },
        query: encodeJsonToB64({ get_price:{ key: process.env.ORACLE_KEY } }),
      }
    ]);
  }

  const beforeQuery = new Date().getTime();
  let response;
  try {
    response = await client.query.compute.queryContract({
      contract_address: process.env.BATCH_QUERY_CONTRACT!,
      code_hash: process.env.BATCH_QUERY_HASH,
      query: queryMsg,
    }) as BatchQueryResponse;
  } catch (e: any) {
    fs.writeFileSync('./results.txt', JSON.stringify(results, null, 2));
    if(e.message.includes('invalid json response')) {
      results.queryErrors += 1;
      return;
    }
    throw new Error(e);
  }

  if(response === undefined) {
    results.queryErrors += 1;
    fs.writeFileSync('./results.txt', JSON.stringify(results, null, 2));
    return;
  }
  const queryLength = (new Date().getTime() - beforeQuery) / 1000;
  results.queryLength.push(queryLength);
  if(results.queryLength.length > 100) {
    // Keep the last 10 query lengths for average calculation
    results.queryLength.shift();
  }

  let borrowAmount = 0;
  let borrowableAmount = 0;
  let silkPrice = 0;
  const liquidatablePositions = response.batch.responses.reduce((prev: {position_id: string, vault_id: string}[], curr) => { 
    if(curr.response.response) {
      const responseData = decodeB64ToJson(curr.response.response);
      const vaultId = decodeB64ToJson(curr.id);
      if(vaultId === 'user_position') {
        borrowAmount = Number(responseData.total_principal_value) + Number(responseData.total_interest_accrued_value);
        borrowableAmount = (Number(responseData.max_borrow_value) * 0.98) - borrowAmount;
        if(borrowableAmount < 0) {
          borrowableAmount = 0;
          isUsingStabilityPool = false;
        }
        return prev;
      }
      if(vaultId === 'oracle') {
        silkPrice = Number(responseData.data.rate / 10**18);
        return prev;
      }
      if(responseData.positions && responseData.positions.length > 0) {
        return [...prev, ...responseData.positions.map((pos: any) => ({
          position_id: pos.position_id,
          vault_id: vaultId,
        }))];
      }
    }
    return prev;
  }, []);

  const borrowCap = Math.floor(((borrowableAmount * 0.98) / silkPrice) 
    * 10**Number(6));

  if(liquidatablePositions.length === 0 && results.txHash === undefined) {
    fs.writeFileSync('./results.txt', JSON.stringify(results, null, 2));
    return;
  }
  const liquidatable = liquidatablePositions[results.totalAttempts % liquidatablePositions.length];

  let executeResponse: TxResponse | null = null; 
  if(results.txHash) {
    executeResponse = await client.query.getTx(results.txHash);
  } else {
    logger.info(`ATTEMPTING - position id: ${liquidatable.position_id} vault id: ${liquidatable.vault_id}`, now);
    results.totalAttempts += 1;
    let msgs: MsgExecuteContract<any>[] = [
      new MsgExecuteContract({ 
        sender: client.address, 
        contract_address: vaultContract.address,
        code_hash: vaultContract.code_hash,
        msg: {
           liquidate: liquidatable, 
        }, 
        sent_funds: [],
      })
    ];
    if(isUsingStabilityPool) {
      msgs = [
        new MsgExecuteContract({ 
          sender: client.address, 
          contract_address: process.env.MONEY_MARKET_ADDRESS!,
          code_hash: process.env.MONEY_MARKET_CODE_HASH!,
          msg: { 
            borrow:{
              token: process.env.SILK_TOKEN_ADDRESS, 
              amount: borrowCap.toFixed(0), 
            } 
          }, 
          sent_funds: [],
        }),
        new MsgExecuteContract({ 
          sender: client.address, 
          contract_address: process.env.SILK_TOKEN_ADDRESS!,
          code_hash: process.env.SILK_TOKEN_CODE_HASH!,
          msg: {
            send: {
              recipient: process.env.STABILITY_POOL_ADDRESS,
              recipient_code_hash: process.env.STABILITY_POOL_CODE_HASH,
              amount: borrowCap.toFixed(0),
              msg: encodeJsonToB64({deposit_silk:{}})
            }
          }, 
          sent_funds: [],
        }),
      ].concat(msgs);
    }
    executeResponse = await client.tx.broadcast(msgs,
      {
        gasLimit: !isUsingStabilityPool ? CONSTANTS.GAS_LIMIT : 2_500_000,
        feeDenom: CONSTANTS.FEE_DENOM,
      },
    )
    if(executeResponse?.transactionHash !== undefined) {
      fs.appendFile('../transactions.txt', `${now.getTime()},${executeResponse.transactionHash},silk,${borrowCap.toFixed(0)}\n`, 
        (err) => {
          if (err) logger.error('Failed to append transaction hash', now, err);
      });
    }
  }
  if(executeResponse === null) {
    throw new Error(`Transaction not found ${results.txHash}`);
  }
  if(executeResponse.code === 0) {
    logger.info(`LIQUIDATION ATTEMPT SUCCESSFUL - ${executeResponse.transactionHash}`, now);
    results.successfulLiquidations += 1;
    if(!executeResponse.arrayLog && !executeResponse.jsonLog) {
      results.txHash = executeResponse.transactionHash;
      throw new Error("Missing log - liquidate");
    }
    logger.info(JSON.stringify(executeResponse.jsonLog), now);
    results.txHash = undefined;
  } else {
    results.failedLiquidations += 1;
    if(executeResponse.rawLog === undefined || executeResponse.rawLog.length === 0) {
      results.txHash = executeResponse.transactionHash;
      throw new Error("Missing log");
    }
    logger.info(JSON.stringify(executeResponse.jsonLog), now);
  }
  if(executeResponse.rawLog?.includes("incorrect account sequence")) {
    throw new Error("account sequence");
  }
  if(executeResponse.rawLog?.includes("out of gas")){
    throw new Error("out of gas");
  }

  fs.writeFileSync('./results.txt', JSON.stringify(results, null, 2));
}

main().catch((error:any) => {logger.error(JSON.stringify(error?.message), new Date());});
