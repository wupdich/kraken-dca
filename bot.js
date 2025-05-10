#!/usr/bin/env node
const crypto = require("crypto");
const https = require("https");

/**
 * Kraken Multi-Crypto DCA Bot
 * Original by @codepleb, enhanced for multi-crypto support
 *
 * Donations in BTC: bc1q4et8wxhsguz8hsm46pnuvq7h68up8mlw6fhqyt
 * Donations in Lightning-BTC (Telegram): codepleb@ln.tips
 */

const main = async () => {
  const KRAKEN_API_PUBLIC_KEY = process.env.KRAKEN_API_PUBLIC_KEY;
  const KRAKEN_API_PRIVATE_KEY = process.env.KRAKEN_API_PRIVATE_KEY;
  const CURRENCY = (process.env.CURRENCY || "USD").toUpperCase();
  const DATE_OF_CASH_REFILL = Number(process.env.DATE_OF_CASH_REFILL);
  const FIAT_CHECK_DELAY = Number(process.env.FIAT_CHECK_DELAY) || 60 * 1000;
  
  const BTC_ALLOCATION = Number(process.env.BTC_ALLOCATION) || 50;
  const ETH_ALLOCATION = Number(process.env.ETH_ALLOCATION) || 25;
  const SOL_ALLOCATION = Number(process.env.SOL_ALLOCATION) || 25;
  
  const KRAKEN_BTC_ORDER_SIZE = Number(process.env.KRAKEN_BTC_ORDER_SIZE) || 0.0001;
  const KRAKEN_ETH_ORDER_SIZE = Number(process.env.KRAKEN_ETH_ORDER_SIZE) || 0.004;
  const KRAKEN_SOL_ORDER_SIZE = Number(process.env.KRAKEN_SOL_ORDER_SIZE) || 0.04;
  
  const KRAKEN_BTC_WITHDRAWAL_ADDRESS_KEY = process.env.KRAKEN_BTC_WITHDRAWAL_ADDRESS_KEY || false;
  const KRAKEN_ETH_WITHDRAWAL_ADDRESS_KEY = process.env.KRAKEN_ETH_WITHDRAWAL_ADDRESS_KEY || false;
  const KRAKEN_SOL_WITHDRAWAL_ADDRESS_KEY = process.env.KRAKEN_SOL_WITHDRAWAL_ADDRESS_KEY || false;
  
  const BTC_WITHDRAW_TARGET = Number(process.env.BTC_WITHDRAW_TARGET) || false;
  const ETH_WITHDRAW_TARGET = Number(process.env.ETH_WITHDRAW_TARGET) || false;
  const SOL_WITHDRAW_TARGET = Number(process.env.SOL_WITHDRAW_TARGET) || false;

  const PUBLIC_API_PATH = "/0/public/";
  const PRIVATE_API_PATH = "/0/private/";

  let cryptoPrefix = "";
  let fiatPrefix = "";
  if (CURRENCY === "USD" || CURRENCY === "EUR" || CURRENCY === "GBP") {
    cryptoPrefix = "X";
    fiatPrefix = "Z";
  }

  const cryptoAssets = {
    BTC: {
      symbol: "XBT",
      responseKey: "XXBT", // Usually correct for Kraken
      allocation: BTC_ALLOCATION,
      orderSize: KRAKEN_BTC_ORDER_SIZE,
      withdrawalAddressKey: KRAKEN_BTC_WITHDRAWAL_ADDRESS_KEY,
      withdrawTarget: BTC_WITHDRAW_TARGET,
      lastPrice: Number.NEGATIVE_INFINITY,
      dateOfNextOrder: new Date(),
      noSuccessfulBuyYet: true,
      allocatedFiat: 0,
      balance: 0, // Initialize balance
      symbol_display: "₿"
    },
    ETH: {
      symbol: "ETH",
      responseKey: "XETH", // Usually correct for Kraken
      allocation: ETH_ALLOCATION,
      orderSize: KRAKEN_ETH_ORDER_SIZE,
      withdrawalAddressKey: KRAKEN_ETH_WITHDRAWAL_ADDRESS_KEY,
      withdrawTarget: ETH_WITHDRAW_TARGET,
      lastPrice: Number.NEGATIVE_INFINITY,
      dateOfNextOrder: new Date(),
      noSuccessfulBuyYet: true,
      allocatedFiat: 0,
      balance: 0, // Initialize balance
      symbol_display: "ETH"
    },
    SOL: {
      symbol: "SOL",
      // IMPORTANT: This 'responseKey' might need to be changed based on the debug output.
      // Common options are "SOL" or "XSOL".
      responseKey: "SOL", 
      allocation: SOL_ALLOCATION,
      orderSize: KRAKEN_SOL_ORDER_SIZE,
      withdrawalAddressKey: KRAKEN_SOL_WITHDRAWAL_ADDRESS_KEY,
      withdrawTarget: SOL_WITHDRAW_TARGET,
      lastPrice: Number.NEGATIVE_INFINITY,
      dateOfNextOrder: new Date(),
      noSuccessfulBuyYet: true,
      allocatedFiat: 0,
      balance: 0, // Initialize balance
      symbol_display: "SOL"
    }
  };

  const { log } = console;

  const withdrawalDate = new Date();
  withdrawalDate.setDate(1);
  withdrawalDate.setMonth(withdrawalDate.getMonth() + 1);

  let lastFiatBalance = Number.NEGATIVE_INFINITY;
  let dateOfEmptyFiat = new Date();
  let logQueue = [`[${new Date().toLocaleString()}]`];
  let firstRun = true;
  let interrupted = 0;
  
  let fiatAmount = undefined;

  log();
  log("|=================================================================|");
  log("|                     ---------------------------                  |");
  log("|                     |   Kraken Multi-DCA Bot   |                 |");
  log("|                     ---------------------------                  |");
  log("|                         Original by @codepleb                    |");
  log("|                                                                  |");
  log("| Donations BTC: bc1q4et8wxhsguz8hsm46pnuvq7h68up8mlw6fhqyt        |");
  log("| Donations Lightning-BTC (Telegram): codepleb@ln.tips             |");
  log("|=================================================================|");
  log();
  log("Multi-Crypto DCA activated now!");
  log("Fiat currency to be used:", CURRENCY);
  log(`Allocations: BTC: ${BTC_ALLOCATION}%, ETH: ${ETH_ALLOCATION}%, SOL: ${SOL_ALLOCATION}%`);
  log(`Minimum order sizes: BTC: ${KRAKEN_BTC_ORDER_SIZE}, ETH: ${KRAKEN_ETH_ORDER_SIZE}, SOL: ${KRAKEN_SOL_ORDER_SIZE}`);

  const debugKrakenAssetPair = async (asset) => {
    log(`==== Debugging ${asset.symbol} AssetPair Info ====`);
    const queryPair = `${asset.symbol}${CURRENCY}`;
    const response = await queryPublicApi("AssetPairs", `pair=${queryPair}`);
    log(`Querying AssetPairs with pair=${queryPair}`);
    log(JSON.stringify(response, null, 2));
    log(`==== End debugging ${asset.symbol} ====`);
  };

  const runner = async () => {
    if (cryptoAssets.SOL.allocation > 0) {
        // await debugKrakenAssetPair(cryptoAssets.SOL); // You can uncomment this if needed for pair debugging
    }
    
    while (true) {
      try {
        let buyOrderExecutedThisCycle = false;
        const balanceResponse = await queryPrivateApi("Balance", ""); // Get the full response

        // Check if the API call itself failed or returned an error structure
        if (balanceResponse?.error?.length > 0) {
            log(`Error fetching balance: ${balanceResponse.error.join(", ")}`);
            printBalanceQueryFailedError(); // This will use the generic message
            await timer(FIAT_CHECK_DELAY);
            continue;
        }

        const balance = balanceResponse?.result; // Extract the 'result' object

        // ***** START OF IMPORTANT DEBUG LOGGING *****
        // This will print the raw 'result' object from the Balance API call.
        // Look for keys like "XXBT", "XETH", "ZUSD", and specifically how Solana is represented (e.g., "SOL", "XSOL").
        log("DEBUG: Full Kraken Balance API Response (result object):", JSON.stringify(balance, null, 2));
        // ***** END OF IMPORTANT DEBUG LOGGING *****

        if (!balance || Object.keys(balance).length === 0) {
          printBalanceQueryFailedError();
          await timer(FIAT_CHECK_DELAY);
          continue;
        }
        
        fiatAmount = Number(
          balance?.[CURRENCY === "AUD" ? "Z" : fiatPrefix + CURRENCY]
        );

        // Check for valid fiat amount (original robust check)
        if (fiatAmount === undefined || isNaN(fiatAmount)) { // Simplified and clear check
          log(`Error: Fiat currency key '${fiatPrefix + CURRENCY}' not found in balance or value is not a number.`);
          printBalanceQueryFailedError(); // This indicates a problem with fiat balance retrieval
          await timer(FIAT_CHECK_DELAY);
          continue;
        }


        // Update crypto balances from Kraken
        for (const key in cryptoAssets) {
          const asset = cryptoAssets[key];
          if (asset.allocation > 0) {
            const rawBalanceValue = balance?.[asset.responseKey];
            if (rawBalanceValue === undefined) {
              // This is not an error, just means 0 balance or key mismatch. Debug log above should clarify.
              logQueue.push(`Note: Balance key '${asset.responseKey}' for ${key} not found in API response. Assuming 0 balance.`);
            }
            asset.balance = Number(rawBalanceValue) || 0;
          }
        }

        logQueue.push(`Fiat: ${Number(fiatAmount).toFixed(2)} ${CURRENCY}`);
        const newFiatArrived = fiatAmount > lastFiatBalance;

        if (newFiatArrived || firstRun) {
          estimateNextFiatDepositDate(firstRun);
          lastFiatBalance = fiatAmount;
          firstRun = false;
          logQueue.push(
            `Empty fiat @ approx. ${dateOfEmptyFiat.toLocaleString()}`
          );
          
          for (const key in cryptoAssets) {
            const asset = cryptoAssets[key];
            if (asset.allocation > 0) {
                asset.allocatedFiat = fiatAmount * (asset.allocation / 100);
                logQueue.push(`${key} allocation: ${asset.allocatedFiat.toFixed(2)} ${CURRENCY} (${asset.allocation}%)`);
            }
          }
        }

        for (const key in cryptoAssets) {
          const asset = cryptoAssets[key];
          if (asset.allocation > 0 && asset.allocatedFiat > 0) {
            asset.lastPrice = await fetchCryptoPrice(asset);
            if (!asset.lastPrice) {
              log(`Failed to fetch price for ${key}! Check pair/ticker. Asset: ${JSON.stringify(asset.symbol)}, Currency: ${CURRENCY}`);
              logQueue.push(`Price fetch failed for ${key}.`); // Add to log queue
              continue; 
            }
            logQueue.push(`${key} Price: ${asset.lastPrice.toFixed(2)} ${CURRENCY}`);
          }
        }

        const now = Date.now();
        for (const key in cryptoAssets) {
          const asset = cryptoAssets[key];
          
          if (asset.allocation === 0) continue;

          if (!asset.lastPrice || asset.lastPrice <= 0 || asset.allocatedFiat <= 0) {
            if (asset.allocatedFiat > 0 && (!asset.lastPrice || asset.lastPrice <= 0)) {
                 logQueue.push(`Skipping ${key} buy: Price ${asset.lastPrice} not available or invalid.`);
            }
            continue;
          }
          
          const canAffordOrder = asset.allocatedFiat >= (asset.lastPrice * asset.orderSize);
          if ((asset.dateOfNextOrder.getTime() <= now || newFiatArrived) && canAffordOrder) { // ensure dateOfNextOrder is a Date object
            const buySuccess = await buyCrypto(asset);
            if(buySuccess) {
                evaluateMillisUntilNextOrder(asset);
                buyOrderExecutedThisCycle = true;
                const updatedBalanceData = (await queryPrivateApi("Balance", ""))?.result;
                if (updatedBalanceData && updatedBalanceData[asset.responseKey] !== undefined) { // Check undefined explicitly
                    asset.balance = Number(updatedBalanceData[asset.responseKey]) || 0;
                } else if (updatedBalanceData) {
                    log(`Warning: Post-buy balance key '${asset.responseKey}' for ${key} not found. Balance may not be updated.`);
                }
            }
          } else if (!canAffordOrder && asset.allocatedFiat > 0) {
             logQueue.push(`Skipping ${key} buy: Allocated fiat ${asset.allocatedFiat.toFixed(2)} ${CURRENCY} is less than order cost estimate (${(asset.lastPrice * asset.orderSize).toFixed(2)} ${CURRENCY}).`);
          }
          
          const currentCryptoAmount = asset.balance;
          const precision = String(asset.orderSize).split(".")[1]?.length || 0;
          logQueue.push(
            `Current ${key}: ${currentCryptoAmount.toFixed(precision)} ${asset.symbol_display}`
          );
          
          if (asset.dateOfNextOrder.getTime() > now && canAffordOrder) {
            logQueue.push(
                `Next ${key} order in: ${formatTimeToHoursAndLess(
                asset.dateOfNextOrder.getTime() - Date.now()
                )} @ ${asset.dateOfNextOrder.toLocaleString().split(", ")[1]}`
            );
          } else if (!canAffordOrder && asset.allocatedFiat > 0) {
             logQueue.push(`Next ${key} order for ${key}: Awaiting sufficient fiat or price drop.`);
          } else if (asset.allocatedFiat <=0) {
             logQueue.push(`Next ${key} order for ${key}: Awaiting fiat allocation.`);
          }


          if (buyOrderExecutedThisCycle && isWithdrawalDue(asset, asset.balance)) {
            await withdrawCrypto(asset, asset.balance);
          }
        }

        flushLogging(buyOrderExecutedThisCycle || newFiatArrived || logQueue.length > 1);
        await timer(FIAT_CHECK_DELAY);
      } catch (e) {
        log("General Error in main loop. :/", e); // Use log for consistency
        if (e.stack) log(e.stack);
        await timer(FIAT_CHECK_DELAY);
      }
    }
  };

  // --- Helper Functions (executeGetRequest, queryPublicApi, etc.) ---
  // These are assumed to be mostly correct from your previous version.
  // Minor logging improvements and error handling added.

    const isWeekend = (date) => date.getDay() % 6 == 0;

    const executeGetRequest = (options) => {
        return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (d) => { data += d; });
            res.on("end", () => {
            try {
                resolve(JSON.parse(data));
            } catch (e) {
                log("Failed to parse JSON response from GET request:", data, "Error:", e.message);
                reject(new Error("Invalid JSON response from GET"));
            }
            });
        });
        req.on("error", (error) => { log("GET Request Error:", error); reject(error); });
        req.end();
        });
    };

    const queryPublicApi = async (endPointName, inputParameters) => {
        const options = {
        hostname: "api.kraken.com", port: 443,
        path: `${PUBLIC_API_PATH}${endPointName}?${inputParameters || ""}`, method: "GET",
        };
        try { return await executeGetRequest(options); }
        catch (e) {
        log(`Could not make GET request to ${endPointName}: ${e.message}`);
        return { error: [`Failed GET request to ${endPointName}`] };
        }
    };

    const executePostRequest = ( apiPostBodyData, apiPath, endpoint, KRAKEN_API_PUBLIC_KEY, signature) => {
        return new Promise((resolve, reject) => {
        const body = apiPostBodyData;
        const options = {
            hostname: "api.kraken.com", port: 443, path: `${apiPath}${endpoint}`, method: "POST",
            headers: {
            "API-Key": KRAKEN_API_PUBLIC_KEY, "API-Sign": signature,
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body)
            },
        };
        const req = https.request(options, (res) => { // No need to pass global.https, direct https is fine
            let data = "";
            res.on("data", (d) => { data += d; });
            res.on("end", () => {
            try {
                resolve(JSON.parse(data));
            } catch (e) {
                log("Failed to parse JSON response from POST request:", data, "Error:", e.message);
                reject(new Error("Invalid JSON response from POST"));
            }
            });
        });
        req.on("error", (error) => { log("POST Request Error:", error); reject(error); });
        req.write(body);
        req.end();
        });
    };

    const queryPrivateApi = async (endpoint, params) => {
        const nonce = Date.now().toString();
        const apiPostBodyData = "nonce=" + nonce + (params ? "&" + params : "");
        const signature = createAuthenticationSignature( KRAKEN_API_PRIVATE_KEY, PRIVATE_API_PATH, endpoint, nonce, apiPostBodyData );
        try { return await executePostRequest( apiPostBodyData, PRIVATE_API_PATH, endpoint, KRAKEN_API_PUBLIC_KEY, signature); }
        catch (e) {
        log(`Could not make successful POST request to ${endpoint}: ${e.message}`);
        return { error: [`Failed POST request to ${endpoint}`] };
        }
    };

    const createAuthenticationSignature = ( apiPrivateKey, apiPath, endPointName, nonce, apiPostBodyData ) => {
        const apiPost = nonce + apiPostBodyData; // This is the data for the SHA256 hash
        const secret = Buffer.from(apiPrivateKey, "base64");
        const sha256 = crypto.createHash("sha256");
        const hash256 = sha256.update(apiPost).digest("binary"); // Correct: sha256(nonce + postdata)
        const hmac512 = crypto.createHmac("sha512", secret);
        // Correct: path + endpointName + sha256(nonce + postdata)
        const signatureString = hmac512.update(apiPath + endPointName + hash256, "binary").digest("base64");
        return signatureString;
    };

    const fetchCryptoPrice = async (asset) => {
        let tickerQueryPair; let keyInResponse;
        if (asset.symbol === "XBT" || asset.symbol === "ETH") {
        tickerQueryPair = `${cryptoPrefix}${asset.symbol}${fiatPrefix}${CURRENCY}`;
        } else {
        tickerQueryPair = `${asset.symbol}${CURRENCY}`; // e.g. SOLUSD
        }
        keyInResponse = tickerQueryPair;

        const response = await queryPublicApi("Ticker", `pair=${tickerQueryPair}`);
        if (response?.error?.length > 0) {
        log(`Error fetching ${asset.symbol} price with pair ${tickerQueryPair}:`, response.error.join(", "));
        if(response.result) { // Attempt fallback even on error if result is partially there
            const resultKeys = Object.keys(response.result);
            const fallbackKey = resultKeys.find(k => k.toUpperCase().includes(asset.symbol.toUpperCase()) && k.toUpperCase().includes(CURRENCY.toUpperCase()));
            if (fallbackKey && response.result[fallbackKey]?.p?.[0]) {
                log(`Using fallback key for ${asset.symbol} price: ${fallbackKey}`);
                return Number(response.result[fallbackKey]?.p?.[0]);
            }
        }
        return null;
        }
        if (response?.result && response.result[keyInResponse]?.p?.[0]) {
        return Number(response.result[keyInResponse]?.p?.[0]);
        }
        if (response?.result) {
        const resultKeys = Object.keys(response.result);
        const alternateKey = `${asset.symbol}${CURRENCY}`;
        if (response.result[alternateKey] && response.result[alternateKey]?.p?.[0]) {
            log(`Using alternate key ${alternateKey} for ${asset.symbol} price from Ticker.`);
            return Number(response.result[alternateKey]?.p?.[0]);
        }
        const matchingKey = resultKeys.find(k => k.toUpperCase().includes(asset.symbol.toUpperCase()) && k.toUpperCase().includes(CURRENCY.toUpperCase()));
        if (matchingKey && response.result[matchingKey]?.p?.[0]) {
            log(`Using fuzzy matching key for ${asset.symbol} price: ${matchingKey}`);
            return Number(response.result[matchingKey]?.p?.[0]);
        }
        }
        log(`Could not find price data for ${asset.symbol} (expected key ${keyInResponse}) in Ticker response:`, JSON.stringify(response, null, 2));
        return null;
    };

    const buyCrypto = async (asset) => {
        let buyOrderResponse;
        try {
        buyOrderResponse = await executeBuyOrder(asset);
        if (buyOrderResponse?.error?.length > 0) {
            log(`Buy-Order for ${asset.symbol} failed: ${buyOrderResponse.error.join(", ")}. Skipping.`);
            return false;
        } else if (buyOrderResponse?.result?.txid?.length > 0) {
            asset.noSuccessfulBuyYet = false;
            logQueue.push(`Kraken Buy ${asset.symbol}: ${buyOrderResponse.result.descr?.order || 'Order placed'} > Success! TxIDs: ${buyOrderResponse.result.txid.join(', ')}`);
            logQueue.push(`Bought ${asset.orderSize} ${asset.symbol} for ~${(asset.lastPrice * asset.orderSize).toFixed(2)} ${CURRENCY}`);
            return true;
        } else {
            log(`Buy-Order response for ${asset.symbol} had unexpected structure: ${JSON.stringify(buyOrderResponse)}. Skipping.`);
            return false;
        }
        } catch (e) {
        log(`Buy order request for ${asset.symbol} threw an exception: ${e.message}. Skipping.`);
        return false;
        }
    };

    const executeBuyOrder = async (asset) => {
        const privateEndpoint = "AddOrder";
        const orderPairName = `${asset.symbol}${CURRENCY}`;
        const privateInputParameters = `pair=${orderPairName}&type=buy&ordertype=market&volume=${asset.orderSize}`;
        return await queryPrivateApi(privateEndpoint, privateInputParameters);
    };

    const executeWithdrawal = async (asset, amount) => {
        const privateEndpoint = "Withdraw";
        const privateInputParameters = `asset=${asset.symbol}&key=${asset.withdrawalAddressKey}&amount=${amount}`;
        return await queryPrivateApi( privateEndpoint, privateInputParameters);
    };

    const isWithdrawalDateDue = () => {
        if (new Date() >= withdrawalDate) {
        withdrawalDate.setDate(1);
        withdrawalDate.setMonth(withdrawalDate.getMonth() + 1);
        return true;
        }
        return false;
    };

    const isWithdrawalDue = (asset, currentAmount) =>
        (asset.withdrawalAddressKey && !asset.withdrawTarget && isWithdrawalDateDue()) ||
        (asset.withdrawalAddressKey && asset.withdrawTarget && asset.withdrawTarget <= currentAmount);

    const printBalanceQueryFailedError = () => {
        flushLogging(true); // Print whatever logs are queued
        log("ERROR: Could not query the balance on your account OR fiat currency key not found/valid. Check API keys, permissions, and CURRENCY setting. Verify fiat key in logged balance response.");
        // The interrupted logic might need refinement if only fiat fails vs full balance
        if (++interrupted >= 3 && firstRun) { // Only escalate to throw if failing from start
            log("FATAL: Too many failed balance queries from start. Exiting.");
            throw Error("Interrupted! Too many failed API calls for account balance from start.");
        }
    };
    
    const withdrawCrypto = async (asset, amountToWithdraw) => {
        const withdrawalAmountStr = amountToWithdraw.toFixed(8); // Ensure sufficient precision
        const msgAttempt = `Attempting to withdraw ${withdrawalAmountStr} ${asset.symbol_display} (${asset.symbol}) to key: ${asset.withdrawalAddressKey} ...`;
        logQueue.push(msgAttempt); log(msgAttempt); // Log to both
        
        const withdrawal = await executeWithdrawal(asset, withdrawalAmountStr);
        if (withdrawal?.result?.refid) {
        const msgSuccess = `Withdrawal of ${withdrawalAmountStr} ${asset.symbol} initiated! Ref ID: ${withdrawal.result.refid}. Date: ${new Date().toLocaleString()}`;
        logQueue.push(msgSuccess); log(msgSuccess);
        } else {
        const msgFail = `Withdrawal of ${withdrawalAmountStr} ${asset.symbol} failed! ${withdrawal?.error?.join(", ") || "Unknown error"}`;
        logQueue.push(msgFail); log(msgFail, withdrawal); // Log full response on fail
        }
    };

    const estimateNextFiatDepositDate = (firstRunArg) => { // Renamed param to avoid conflict
        dateOfEmptyFiat = new Date(); 
        if (!isNaN(DATE_OF_CASH_REFILL) && DATE_OF_CASH_REFILL > 0 && DATE_OF_CASH_REFILL <= 31) {
            if (firstRunArg) {
                dateOfEmptyFiat.setDate(DATE_OF_CASH_REFILL);
                if (dateOfEmptyFiat.getTime() <= Date.now()) {
                    dateOfEmptyFiat.setMonth(dateOfEmptyFiat.getMonth() + 1);
                }
            } else {
                const currentMonthRefillDate = new Date(dateOfEmptyFiat);
                currentMonthRefillDate.setDate(DATE_OF_CASH_REFILL);
                if (currentMonthRefillDate.getTime() > dateOfEmptyFiat.getTime()) {
                    dateOfEmptyFiat = currentMonthRefillDate;
                } else {
                    dateOfEmptyFiat.setMonth(dateOfEmptyFiat.getMonth() + 1);
                    dateOfEmptyFiat.setDate(DATE_OF_CASH_REFILL);
                }
            }
        } else {
            dateOfEmptyFiat.setMonth(dateOfEmptyFiat.getMonth() + 1);
            if (firstRunArg) logQueue.push("Note: DATE_OF_CASH_REFILL not set or invalid, estimating next deposit as one month from now.");
        }
        if (isWeekend(dateOfEmptyFiat)) dateOfEmptyFiat.setDate(dateOfEmptyFiat.getDate() - (dateOfEmptyFiat.getDay() === 6 ? 1 : 2));
    };

    const evaluateMillisUntilNextOrder = (asset) => {
        if (asset.lastPrice > 0 && asset.allocatedFiat > 0) {
        const fiatForThisAsset = asset.allocatedFiat;
        const valueInCrypto = fiatForThisAsset / asset.lastPrice;
        const numPossibleOrders = Math.floor(valueInCrypto / asset.orderSize);

        if (numPossibleOrders < 1) {
            asset.dateOfNextOrder = new Date(Date.now() + 24 * 60 * 60 * 1000 * 7); // Try again in 7 days, or new fiat arrival
            logQueue.push( `Not enough allocated fiat for ${asset.symbol} (${fiatForThisAsset.toFixed(2)} ${CURRENCY}) for a min order. Waiting for more fiat/price change.`);
        } else {
            const now = Date.now();
            const timeWindowMs = dateOfEmptyFiat.getTime() - now;
            if (timeWindowMs <= FIAT_CHECK_DELAY) { // If refill date is very soon or past
                asset.dateOfNextOrder = new Date(now + FIAT_CHECK_DELAY); // Try to buy soon
            } else {
                const millisPerOrder = Math.max(FIAT_CHECK_DELAY, timeWindowMs / numPossibleOrders); // Ensure at least FIAT_CHECK_DELAY
                asset.dateOfNextOrder = new Date(now + millisPerOrder);
            }
        }
        } else if (asset.allocatedFiat <= 0 && asset.allocation > 0) {
        asset.dateOfNextOrder = new Date(Date.now() + 24 * 60 * 60 * 1000 * 7);
        logQueue.push(`No fiat currently allocated for ${asset.symbol}. Waiting for fiat allocation.`);
        } else if (asset.allocation > 0) { // Has allocation but price is 0 or invalid
        asset.dateOfNextOrder = new Date(Date.now() + FIAT_CHECK_DELAY * 5);
        logQueue.push(`Cannot evaluate next order time for ${asset.symbol}: price ${asset.lastPrice}, allocated fiat ${asset.allocatedFiat}. Retrying soon.`);
        }
    };

    const formatTimeToHoursAndLess = (timeInMillis) => {
        if (timeInMillis < 0) timeInMillis = 0;
        const hours = Math.floor(timeInMillis / (1000 * 60 * 60));
        const minutes = Math.floor((timeInMillis / (1000 * 60)) % 60);
        const seconds = Math.floor((timeInMillis / 1000) % 60);
        return `${hours}h ${minutes}m ${seconds}s`;
    };

    const flushLogging = (printLogs) => {
        if (printLogs && logQueue.length > 1) { log(logQueue.join(" > "));}
        logQueue = [`[${new Date().toLocaleString()}]`];
    };

    const timer = (delay) => new Promise((resolve) => { setTimeout(resolve, delay); });

    const totalAllocation = Object.values(cryptoAssets).reduce((sum, asset) => sum + asset.allocation, 0);
    if (totalAllocation > 100) {
        log(`FATAL: Total crypto allocation (${totalAllocation}%) exceeds 100%. Adjust env vars.`);
        process.exit(1);
    }
    if (totalAllocation === 0) { log(`WARNING: Total crypto allocation is 0%. Bot will not buy crypto.`); }
    else if (totalAllocation < 100) { log(`WARNING: Total crypto allocation is ${totalAllocation}%, < 100%. Some fiat may remain unallocated.`);}

    if (!KRAKEN_API_PUBLIC_KEY || !KRAKEN_API_PRIVATE_KEY) {
        log("FATAL: Kraken API public or private key is missing. Set KRAKEN_API_PUBLIC_KEY and KRAKEN_API_PRIVATE_KEY env vars.");
        process.exit(1);
    }

    (async () => {
        try { await runner(); }
        catch (e) {
        flushLogging(true);
        log("Unhandled error in main execution block. Bot will exit.", e);
        if (e.stack) log(e.stack);
        process.exit(1);
        }
    })();
};

main();
