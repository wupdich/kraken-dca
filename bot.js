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
  const KRAKEN_API_PUBLIC_KEY = process.env.KRAKEN_API_PUBLIC_KEY; // Kraken API public key
  const KRAKEN_API_PRIVATE_KEY = process.env.KRAKEN_API_PRIVATE_KEY; // Kraken API private key
  const CURRENCY = (process.env.CURRENCY || "USD").toUpperCase(); // Ensure CURRENCY is uppercase
  const DATE_OF_CASH_REFILL = Number(process.env.DATE_OF_CASH_REFILL); // OPTIONAL! Day of month, where new funds get deposited regularly (ignore weekends, that will be handled automatically)
  const FIAT_CHECK_DELAY = Number(process.env.FIAT_CHECK_DELAY) || 60 * 1000; // OPTIONAL! Custom fiat check delay. This delay should not be smaller than the delay between orders.
  
  // Crypto configuration
  const BTC_ALLOCATION = Number(process.env.BTC_ALLOCATION) || 50; // Default allocation: 50%
  const ETH_ALLOCATION = Number(process.env.ETH_ALLOCATION) || 25; // Default allocation: 25%
  const SOL_ALLOCATION = Number(process.env.SOL_ALLOCATION) || 25; // Default allocation: 25%
  
  // Minimum order sizes
  const KRAKEN_BTC_ORDER_SIZE = Number(process.env.KRAKEN_BTC_ORDER_SIZE) || 0.0001; // Minimum BTC order
  const KRAKEN_ETH_ORDER_SIZE = Number(process.env.KRAKEN_ETH_ORDER_SIZE) || 0.004; // Minimum ETH order
  const KRAKEN_SOL_ORDER_SIZE = Number(process.env.KRAKEN_SOL_ORDER_SIZE) || 0.04; // Minimum SOL order
  
  // Withdrawal configuration
  const KRAKEN_BTC_WITHDRAWAL_ADDRESS_KEY = process.env.KRAKEN_WITHDRAWAL_ADDRESS_KEY || false;
  const KRAKEN_ETH_WITHDRAWAL_ADDRESS_KEY = process.env.KRAKEN_ETH_WITHDRAWAL_ADDRESS_KEY || false;
  const KRAKEN_SOL_WITHDRAWAL_ADDRESS_KEY = process.env.KRAKEN_SOL_WITHDRAWAL_ADDRESS_KEY || false;
  
  const BTC_WITHDRAW_TARGET = Number(process.env.BTC_WITHDRAW_TARGET) || false; // Corrected variable name
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

  // Define crypto assets configuration
  const cryptoAssets = {
    BTC: {
      symbol: "XBT", // Kraken uses XBT for Bitcoin (used for constructing pairs and withdrawal asset name)
      responseKey: "XXBT", // How it appears in balance response (Kraken's X-prefixed asset name for balance)
      allocation: BTC_ALLOCATION,
      orderSize: KRAKEN_BTC_ORDER_SIZE,
      withdrawalAddressKey: KRAKEN_BTC_WITHDRAWAL_ADDRESS_KEY,
      withdrawTarget: BTC_WITHDRAW_TARGET,
      lastPrice: Number.NEGATIVE_INFINITY,
      dateOfNextOrder: new Date(),
      noSuccessfulBuyYet: true,
      allocatedFiat: 0,
      symbol_display: "₿"
    },
    ETH: {
      symbol: "ETH", // Standard symbol for ETH
      responseKey: "XETH", // How it appears in balance response (Kraken's X-prefixed asset name)
      allocation: ETH_ALLOCATION,
      orderSize: KRAKEN_ETH_ORDER_SIZE,
      withdrawalAddressKey: KRAKEN_ETH_WITHDRAWAL_ADDRESS_KEY,
      withdrawTarget: ETH_WITHDRAW_TARGET,
      lastPrice: Number.NEGATIVE_INFINITY,
      dateOfNextOrder: new Date(),
      noSuccessfulBuyYet: true,
      allocatedFiat: 0,
      symbol_display: "ETH"
    },
    SOL: {
      symbol: "SOL", // Standard symbol for SOL
      responseKey: "SOL", // How SOL appears in balance response (often not X-prefixed for newer assets)
      allocation: SOL_ALLOCATION,
      orderSize: KRAKEN_SOL_ORDER_SIZE,
      withdrawalAddressKey: KRAKEN_SOL_WITHDRAWAL_ADDRESS_KEY,
      withdrawTarget: SOL_WITHDRAW_TARGET,
      lastPrice: Number.NEGATIVE_INFINITY,
      dateOfNextOrder: new Date(),
      noSuccessfulBuyYet: true,
      allocatedFiat: 0,
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

  // Optional debugging function to understand Kraken's asset pair format
  const debugKrakenAssetPair = async (asset) => {
    console.log(`==== Debugging ${asset.symbol} AssetPair Info ====`);
    // For AssetPairs endpoint, the pair is typically ASSETSYMBOL + CURRENCYSYMBOL, e.g., XBTUSD, SOLUSD
    const queryPair = `${asset.symbol}${CURRENCY}`;
    const response = await queryPublicApi(
      "AssetPairs",
      `pair=${queryPair}` // CORRECTED: Use uppercase standard pair name
    );
    console.log(`Querying AssetPairs with pair=${queryPair}`);
    console.log(JSON.stringify(response, null, 2));
    console.log(`==== End debugging ${asset.symbol} ====`);
  };

  const runner = async () => {
    // Debug SOL pricing on startup to help understand the API response format
    // You might want to debug other assets too if issues persist
    if (cryptoAssets.SOL.allocation > 0) { // Only debug if SOL is actually configured
        await debugKrakenAssetPair(cryptoAssets.SOL);
    }
    
    while (true) {
      try {
        let buyOrderExecutedThisCycle = false; // Renamed for clarity within the loop cycle
        const balance = (await queryPrivateApi("Balance", ""))?.result;
        fiatAmount = Number(
          balance?.[CURRENCY === "AUD" ? "Z" : fiatPrefix + CURRENCY]
        );

        if (
          !balance ||
          Object.keys(balance).length === 0 ||
          (fiatAmount !== 0 && !fiatAmount && fiatAmount !== undefined) // Allow fiatAmount to be 0
        ) {
          printBalanceQueryFailedError();
          await timer(FIAT_CHECK_DELAY);
          continue;
        }

        // Update crypto balances from Kraken
        for (const key in cryptoAssets) {
          const asset = cryptoAssets[key];
          if (asset.allocation > 0) { // Only process active assets
            asset.balance = Number(balance?.[asset.responseKey]) || 0;
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
          
          // Calculate allocated fiat for each crypto
          for (const key in cryptoAssets) {
            const asset = cryptoAssets[key];
            if (asset.allocation > 0) {
                asset.allocatedFiat = fiatAmount * (asset.allocation / 100);
                logQueue.push(`${key} allocation: ${asset.allocatedFiat.toFixed(2)} ${CURRENCY} (${asset.allocation}%)`);
            }
          }
        }

        // Fetch prices for all cryptos
        for (const key in cryptoAssets) {
          const asset = cryptoAssets[key];
          if (asset.allocation > 0 && asset.allocatedFiat > 0) { // Only fetch price if allocated and has fiat
            asset.lastPrice = await fetchCryptoPrice(asset);
            if (!asset.lastPrice) {
              console.error(`Failed to fetch price for ${key}! Ensure pair is correct and liquidity exists.`);
              // Don't skip the whole cycle, just this asset's buy for now
              continue; 
            }
            logQueue.push(`${key} Price: ${asset.lastPrice.toFixed(2)} ${CURRENCY}`);
          }
        }

        const now = Date.now();
        // Process each crypto
        for (const key in cryptoAssets) {
          const asset = cryptoAssets[key];
          
          if (asset.allocation === 0) continue; // Skip if not allocated

          // Skip if price couldn't be fetched or no fiat allocated
          if (!asset.lastPrice || asset.lastPrice <= 0 || asset.allocatedFiat <= 0) {
            if (asset.allocatedFiat > 0 && (!asset.lastPrice || asset.lastPrice <= 0)) {
                 logQueue.push(`Skipping ${key} buy: Price not available or invalid.`);
            }
            continue;
          }
          
          // Check if it's time to buy
          // Condition: (Next order time is past OR new fiat arrived) AND has fiat for this asset AND this asset's fiat can cover a minimum order
          const canAffordOrder = asset.allocatedFiat >= (asset.lastPrice * asset.orderSize);
          if ((asset.dateOfNextOrder < now || newFiatArrived) && canAffordOrder) {
            const buySuccess = await buyCrypto(asset); // buyCrypto will return true on success
            if(buySuccess) {
                evaluateMillisUntilNextOrder(asset);
                buyOrderExecutedThisCycle = true;
                 // Refresh balance for this asset after a successful buy
                const updatedBalance = (await queryPrivateApi("Balance", ""))?.result;
                if (updatedBalance && updatedBalance[asset.responseKey]) {
                    asset.balance = Number(updatedBalance[asset.responseKey]) || 0;
                }
            }
          } else if (!canAffordOrder && asset.allocatedFiat > 0) {
             logQueue.push(`Skipping ${key} buy: Allocated fiat ${asset.allocatedFiat.toFixed(2)} ${CURRENCY} is less than order cost estimate (${(asset.lastPrice * asset.orderSize).toFixed(2)} ${CURRENCY}).`);
          }
          
          // Calculate and log balance (use current asset.balance which might have been updated)
          const currentCryptoAmount = asset.balance; // Use actual balance
          const precision = String(asset.orderSize).split(".")[1]?.length || 0;
          logQueue.push(
            `Current ${key}: ${currentCryptoAmount.toFixed(precision)} ${asset.symbol_display}`
          );
          
          if (asset.dateOfNextOrder > now && canAffordOrder) {
            logQueue.push(
                `Next ${key} order in: ${formatTimeToHoursAndLess(
                asset.dateOfNextOrder.getTime() - Date.now()
                )} @ ${asset.dateOfNextOrder.toLocaleString().split(", ")[1]}`
            );
          } else if (!canAffordOrder && asset.allocatedFiat > 0) {
             logQueue.push(`Next ${key} order: Awaiting sufficient fiat or price drop.`);
          } else if (asset.allocatedFiat <=0) {
             logQueue.push(`Next ${key} order: Awaiting fiat allocation.`);
          }


          // Check for withdrawal
          if (buyOrderExecutedThisCycle && isWithdrawalDue(asset, asset.balance)) { // Use current balance for withdrawal check
            await withdrawCrypto(asset, asset.balance); // Withdraw the current balance
          }
        }

        flushLogging(buyOrderExecutedThisCycle || newFiatArrived); // Log if a buy happened or new fiat came
        await timer(FIAT_CHECK_DELAY);
      } catch (e) {
        console.error("General Error in main loop. :/", e);
        await timer(FIAT_CHECK_DELAY);
      }
    }
  };

  const isWeekend = (date) => date.getDay() % 6 == 0;

  const executeGetRequest = (options) => {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (d) => {
          data += d;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            console.error("Failed to parse JSON response from GET request:", data);
            reject(new Error("Invalid JSON response"));
          }
        });
      });

      req.on("error", (error) => {
        console.error("GET Request Error:", error);
        reject(error);
      });
      req.end();
    });
  };

  const queryPublicApi = async (endPointName, inputParameters) => {
    const options = {
      hostname: "api.kraken.com",
      port: 443,
      path: `${PUBLIC_API_PATH}${endPointName}?${inputParameters || ""}`,
      method: "GET",
    };

    try {
      return await executeGetRequest(options);
    } catch (e) {
      console.error(`Could not make GET request to ${endPointName}: ${e.message}`);
      return { error: [`Failed GET request to ${endPointName}`] }; // Return error structure
    }
  };

  const executePostRequest = (
    apiPostBodyData,
    apiPath,
    endpoint,
    KRAKEN_API_PUBLIC_KEY,
    signature,
    https // Note: this https parameter shadows the global require("https")
  ) => {
    return new Promise((resolve, reject) => {
      const body = apiPostBodyData;
      const options = {
        hostname: "api.kraken.com",
        port: 443,
        path: `${apiPath}${endpoint}`,
        method: "POST",
        headers: {
          "API-Key": KRAKEN_API_PUBLIC_KEY,
          "API-Sign": signature,
          "Content-Type": "application/x-www-form-urlencoded", // Good practice
          "Content-Length": Buffer.byteLength(body) // Good practice
        },
      };

      const req = global.https.request(options, (res) => { // Use global.https to avoid shadow
        let data = "";
        res.on("data", (d) => { data += d; });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            console.error("Failed to parse JSON response from POST request:", data);
            reject(new Error("Invalid JSON response"));
          }
        });
      });

      req.on("error", (error) => {
        console.error("POST Request Error:", error);
        reject(error);
      });

      req.write(body);
      req.end();
    });
  };

  const queryPrivateApi = async (endpoint, params) => {
    const nonce = Date.now().toString();
    const apiPostBodyData = "nonce=" + nonce + (params ? "&" + params : ""); // Ensure params is appended correctly

    const signature = createAuthenticationSignature(
      KRAKEN_API_PRIVATE_KEY,
      PRIVATE_API_PATH,
      endpoint,
      nonce,
      apiPostBodyData
    );

    try {
      return await executePostRequest(
        apiPostBodyData,
        PRIVATE_API_PATH,
        endpoint,
        KRAKEN_API_PUBLIC_KEY,
        signature,
        https // This passes the global https module, which is fine.
      );
    } catch (e) {
      console.error(`Could not make successful POST request to ${endpoint}: ${e.message}`);
      return { error: [`Failed POST request to ${endpoint}`] }; // Return error structure
    }
  };

  const createAuthenticationSignature = (
    apiPrivateKey,
    apiPath,
    endPointName,
    nonce,
    apiPostBodyData
  ) => {
    const apiPost = nonce + apiPostBodyData; // This is what Kraken expects for the message
    const secret = Buffer.from(apiPrivateKey, "base64");
    const sha256 = crypto.createHash("sha256");
    // The message for HMAC-SHA512 is path + SHA256(nonce + postdata)
    const hash256 = sha256.update(nonce + apiPostBodyData).digest("binary"); // Corrected to use (nonce + postdata) for SHA256 hash
    const hmac512 = crypto.createHmac("sha512", secret);
    const signatureString = hmac512
      .update(apiPath + endPointName + hash256, "binary") // Path + EndpointName + hash(nonce + postdata)
      .digest("base64");
    return signatureString;
  };

  const fetchCryptoPrice = async (asset) => {
    let tickerQueryPair; // The pair name used for the API query, e.g., XXBTZUSD, SOLUSD
    let keyInResponse;   // The key expected in Kraken's Ticker JSON response, typically same as tickerQueryPair

    // asset.symbol is "XBT", "ETH", "SOL"
    // CURRENCY is "USD", "EUR", etc. (uppercase)
    // cryptoPrefix is "X" or "", fiatPrefix is "Z" or ""

    if (asset.symbol === "XBT" || asset.symbol === "ETH") {
      // For "traditional" cryptos, Kraken often uses X-crypto Z-fiat for ticker keys like XXBTZUSD
      tickerQueryPair = `${cryptoPrefix}${asset.symbol}${fiatPrefix}${CURRENCY}`;
    } else {
      // For newer assets like SOL, it's often just SYMBOLCURRENCY, e.g., SOLUSD
      tickerQueryPair = `${asset.symbol}${CURRENCY}`;
    }
    keyInResponse = tickerQueryPair; // Assuming the query pair is also the key in the response.

    // console.log(`Fetching price for ${asset.symbol} with Ticker API query: pair=${tickerQueryPair}, expecting key in response: ${keyInResponse}`);
    
    const response = await queryPublicApi(
      "Ticker",
      `pair=${tickerQueryPair}` // CORRECTED: Use the correctly cased pair name
    );
    
    if (response?.error?.length > 0) {
      console.error(`Error fetching ${asset.symbol} price with pair ${tickerQueryPair}:`, response.error.join(", "));
      // Attempt fallback if main key not found but response.result exists
      if(response.result) {
        const resultKeys = Object.keys(response.result);
        const fallbackKey = resultKeys.find(k => 
            k.toUpperCase().includes(asset.symbol.toUpperCase()) && 
            k.toUpperCase().includes(CURRENCY.toUpperCase())
        );
        if (fallbackKey && response.result[fallbackKey]?.p?.[0]) {
            console.log(`Using fallback key for ${asset.symbol} price: ${fallbackKey}`);
            return Number(response.result[fallbackKey]?.p?.[0]);
        }
      }
      return null;
    }
    
    if (response?.result && response.result[keyInResponse]) {
      return Number(response.result[keyInResponse]?.p?.[0]);
    }
    
    // Fallback if specific key (e.g. XXBTZUSD) not found, try to find a more general one (e.g. XBTUSD might be an alias in some responses)
    if (response?.result) {
      const resultKeys = Object.keys(response.result);
      // console.log(`Available keys in Ticker response for ${asset.symbol}:`, resultKeys);
      const alternateKey = `${asset.symbol}${CURRENCY}`; // e.g. XBTUSD
      if (response.result[alternateKey] && response.result[alternateKey]?.p?.[0]) {
        console.log(`Using alternate key ${alternateKey} for ${asset.symbol} price from Ticker.`);
        return Number(response.result[alternateKey]?.p?.[0]);
      }

      // User's original fallback logic
      const matchingKey = resultKeys.find(k => 
        k.toUpperCase().includes(asset.symbol.toUpperCase()) && 
        k.toUpperCase().includes(CURRENCY.toUpperCase())
      );
      if (matchingKey && response.result[matchingKey]?.p?.[0]) {
        console.log(`Using fuzzy matching key for ${asset.symbol} price: ${matchingKey}`);
        return Number(response.result[matchingKey]?.p?.[0]);
      }
    }
    
    console.error(`Could not find price data for ${asset.symbol} (expected key ${keyInResponse}) in Ticker response:`, JSON.stringify(response, null, 2));
    return null;
  };

  const buyCrypto = async (asset) => {
    let buyOrderResponse;
    try {
      buyOrderResponse = await executeBuyOrder(asset);
      if (buyOrderResponse?.error?.length > 0) { // Kraken API errors are in an array
        console.error(
          `Buy-Order for ${asset.symbol} failed: ${buyOrderResponse.error.join(", ")}. Skipping this buy order.`
        );
        return false; // Indicate failure
      } else if (buyOrderResponse?.result?.txid?.length > 0) { // Successful orders have transaction IDs
        asset.noSuccessfulBuyYet = false;
        logQueue.push(
          `Kraken Buy ${asset.symbol}: ${buyOrderResponse.result.descr?.order || 'Order placed'} > Success! TxIDs: ${buyOrderResponse.result.txid.join(', ')}`
        );
        logQueue.push(
          `Bought ${asset.orderSize} ${asset.symbol} for ~${(asset.lastPrice * asset.orderSize).toFixed(
            2
          )} ${CURRENCY}`
        );
        return true; // Indicate success
      } else {
        console.error(
          `Buy-Order response for ${asset.symbol} had unexpected structure: ${JSON.stringify(buyOrderResponse)}. Skipping this buy order.`
        );
        return false; // Indicate failure
      }
    } catch (e) {
      console.error(
        `Buy order request for ${asset.symbol} threw an exception: ${e.message}. Skipping this one.`
      );
      return false; // Indicate failure
    }
  };

  const executeBuyOrder = async (asset) => {
    const privateEndpoint = "AddOrder";
    // For AddOrder, Kraken typically uses standard pairs like XBTUSD, ETHUSD, SOLUSD.
    // asset.symbol is "XBT", "ETH", "SOL". CURRENCY is "USD", "EUR", etc. (uppercase)
    const orderPairName = `${asset.symbol}${CURRENCY}`; 
    
    const privateInputParameters = `pair=${orderPairName}&type=buy&ordertype=market&volume=${asset.orderSize}`;
    
    // console.log(`Executing buy order: ${privateInputParameters}`);
    
    return await queryPrivateApi(
      privateEndpoint,
      privateInputParameters
    );
  };

  const executeWithdrawal = async (asset, amount) => {
    const privateEndpoint = "Withdraw";
    // asset.symbol is "XBT", "ETH", "SOL" which are valid for asset parameter in Withdraw
    const privateInputParameters = `asset=${asset.symbol}&key=${asset.withdrawalAddressKey}&amount=${amount}`;
    // console.log(`Executing withdrawal: asset=${asset.symbol}, key=${asset.withdrawalAddressKey}, amount=${amount}`);
    return await queryPrivateApi(
      privateEndpoint,
      privateInputParameters
    );
  };

  const isWithdrawalDateDue = () => {
    if (new Date() >= withdrawalDate) { // Use >= for safety
      withdrawalDate.setDate(1); // Reset to first of next month
      withdrawalDate.setMonth(withdrawalDate.getMonth() + 1);
      return true;
    }
    return false;
  };

  const isWithdrawalDue = (asset, currentAmount) => // Use currentAmount
    (asset.withdrawalAddressKey &&
      !asset.withdrawTarget && // If target is not set (false or 0), use date based
      isWithdrawalDateDue()) ||
    (asset.withdrawalAddressKey &&
      asset.withdrawTarget && // If target is set
      asset.withdrawTarget <= currentAmount);

  const printInvalidCurrencyError = () => { // This error is less likely with CURRENCY.toUpperCase()
    flushLogging(true); // Flush with true to print existing logs
    console.error(
      "Error related to currency symbol or pair construction. If at startup, check CURRENCY env var. Otherwise, might be a temporary API issue or incorrect pair for an asset."
    );
    let allFailedInitialBuy = true;
    for (const key in cryptoAssets) {
      if (cryptoAssets[key].allocation > 0 && !cryptoAssets[key].noSuccessfulBuyYet) {
        allFailedInitialBuy = false;
        break;
      }
    }
    if (++interrupted >= 3 && allFailedInitialBuy) {
      throw Error("Interrupted! Too many failed API calls affecting all assets from start.");
    }
  };
  
  // This function might not be directly called if price fetching returns null instead of throwing
  const printPriceFetchFailedError = (assetKey) => {
    // Log specific to asset price failure, already logged in fetchCryptoPrice
    // This might be more for a general "couldn't get any prices" scenario
  };

  const printInvalidBtcHoldings = () => { // Renamed to printInvalidCryptoHoldings
    flushLogging(true);
    console.error(
      "Couldn't fetch crypto holdings accurately or consistently. This is most probably a temporary issue with Kraken that will fix itself, or an issue with 'responseKey' in cryptoAssets config."
    );
  };

  const printBalanceQueryFailedError = () => {
    flushLogging(true);
    console.error(
      "Could not query the balance on your account. Either incorrect API key/secret, insufficient key-permissions on Kraken, or network issue!"
    );
    let allFailedInitialBuy = true;
    for (const key in cryptoAssets) {
        if (cryptoAssets[key].allocation > 0 && !cryptoAssets[key].noSuccessfulBuyYet) {
            allFailedInitialBuy = false;
            break;
        }
    }
    if (++interrupted >= 3 && allFailedInitialBuy) { // Only throw if initial setup fails repeatedly for all
      throw Error("Interrupted! Too many failed API calls for account balance from start.");
    }
  };

  const withdrawCrypto = async (asset, amountToWithdraw) => {
    // Ensure amount is above any dust limits if applicable, though Kraken usually handles this.
    // Format amount to string with appropriate precision for the API if necessary.
    const withdrawalAmountStr = amountToWithdraw.toFixed(8); // Example precision, adjust if needed per asset
    logQueue.push(`Attempting to withdraw ${withdrawalAmountStr} ${asset.symbol_display} (${asset.symbol}) to key: ${asset.withdrawalAddressKey} ...`);
    console.log(`Attempting to withdraw ${withdrawalAmountStr} ${asset.symbol_display} (${asset.symbol}) to key: ${asset.withdrawalAddressKey} ...`); // Also direct log
    
    const withdrawal = await executeWithdrawal(asset, withdrawalAmountStr);
    if (withdrawal?.result?.refid) {
      const message = `Withdrawal of ${withdrawalAmountStr} ${asset.symbol} initiated! Ref ID: ${withdrawal.result.refid}. Date: ${new Date().toLocaleString()}`;
      logQueue.push(message);
      console.log(message);
    } else {
      const errorMessage = `Withdrawal of ${withdrawalAmountStr} ${asset.symbol} failed! ${withdrawal?.error?.join(", ") || "Unknown error"}`;
      logQueue.push(errorMessage);
      console.error(errorMessage, withdrawal);
    }
  };

  const estimateNextFiatDepositDate = (firstRun) => {
    dateOfEmptyFiat = new Date(); // Start from today

    if (!isNaN(DATE_OF_CASH_REFILL) && DATE_OF_CASH_REFILL > 0 && DATE_OF_CASH_REFILL <= 31) {
        if (firstRun) {
            dateOfEmptyFiat.setDate(DATE_OF_CASH_REFILL);
            // If refill day for current month is already past or today, set for next month
            if (dateOfEmptyFiat.getTime() <= Date.now()) {
                dateOfEmptyFiat.setMonth(dateOfEmptyFiat.getMonth() + 1);
            }
        } else {
            // If not first run, assume current funds will last until approx. next refill date from current month forward
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
        // If DATE_OF_CASH_REFILL is not set, default to estimating one month from now
        dateOfEmptyFiat.setMonth(dateOfEmptyFiat.getMonth() + 1);
        logQueue.push("DATE_OF_CASH_REFILL not set or invalid, estimating next deposit as one month from now.");
    }


    // Adjust for weekends (move to Friday if on Sat/Sun)
    if (isWeekend(dateOfEmptyFiat)) dateOfEmptyFiat.setDate(dateOfEmptyFiat.getDate() - (dateOfEmptyFiat.getDay() === 6 ? 1 : 2)); // Sat -> Fri, Sun -> Fri
  };

  const evaluateMillisUntilNextOrder = (asset) => {
    if (asset.lastPrice > 0 && asset.allocatedFiat > 0) {
      const fiatForThisAsset = asset.allocatedFiat;
      const valueInCrypto = fiatForThisAsset / asset.lastPrice;
      
      // How many minimum orders can be made with the current allocated fiat for this asset
      const numPossibleOrders = Math.floor(valueInCrypto / asset.orderSize);

      if (numPossibleOrders < 1) {
        // Not enough fiat for even one order, wait for more fiat or price drop.
        // Set next order time far in the future, or rely on newFiatArrived flag.
        // For now, let's just log and not set a close dateOfNextOrder. It will try on next newFiatArrived.
        asset.dateOfNextOrder = new Date(Date.now() + 24 * 60 * 60 * 1000 * 30); // e.g. 30 days, effectively waiting for new fiat
        logQueue.push(
          `Not enough allocated fiat for ${asset.symbol} (${fiatForThisAsset.toFixed(2)} ${CURRENCY}) to make a minimum order of ${asset.orderSize} ${asset.symbol_display} at current price ${asset.lastPrice.toFixed(2)} ${CURRENCY}. Waiting for more fiat.`
        );
      } else {
        const now = Date.now();
        const timeWindowMs = dateOfEmptyFiat.getTime() - now; // Time until expected fiat exhaustion/refill

        if (timeWindowMs <= 0) { // Refill date is past or now, buy aggressively if possible
            asset.dateOfNextOrder = new Date(now); // Try to buy ASAP
        } else {
            // Distribute buys over the time window
            const millisPerOrder = timeWindowMs / numPossibleOrders;
            asset.dateOfNextOrder = new Date(now + millisPerOrder);
        }
      }
    } else if (asset.allocatedFiat <= 0) {
      asset.dateOfNextOrder = new Date(Date.now() + 24 * 60 * 60 * 1000 * 30); // No fiat, wait
      logQueue.push(`No fiat allocated for ${asset.symbol}. Waiting for fiat allocation.`);
    }
    else {
      logQueue.push(`Cannot evaluate next order time for ${asset.symbol}: price ${asset.lastPrice}, allocated fiat ${asset.allocatedFiat}`);
      // Keep current dateOfNextOrder or set to a default check interval
      asset.dateOfNextOrder = new Date(Date.now() + FIAT_CHECK_DELAY * 5); // Check again in 5 cycles
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
    if (printLogs && logQueue.length > 1) { // Only print if there's more than just the timestamp
        log(logQueue.join(" > "));
    }
    logQueue = [`[${new Date().toLocaleString()}]`];
  };

  const timer = (delay) =>
    new Promise((resolve) => {
      setTimeout(resolve, delay);
    });

  // Validate total allocation does not exceed 100%
  const totalAllocation = Object.values(cryptoAssets).reduce((sum, asset) => sum + asset.allocation, 0);
  if (totalAllocation > 100) {
    console.error(`FATAL: Total crypto allocation (${totalAllocation}%) exceeds 100%. Please adjust allocations in environment variables.`);
    process.exit(1);
  }
  if (totalAllocation === 0) {
    console.warn(`WARNING: Total crypto allocation is 0%. The bot will not buy any crypto.`);
  } else if (totalAllocation < 100) {
    console.warn(`WARNING: Total crypto allocation is ${totalAllocation}%, which is less than 100%. Some fiat may remain unallocated.`);
  }


  // Check for API keys
  if (!KRAKEN_API_PUBLIC_KEY || !KRAKEN_API_PRIVATE_KEY) {
    console.error("FATAL: Kraken API public or private key is missing. Set KRAKEN_API_PUBLIC_KEY and KRAKEN_API_PRIVATE_KEY environment variables.");
    process.exit(1);
  }


  (async () => {
    try {
      await runner();
    } catch (e) {
      flushLogging(true);
      console.error("Unhandled error in main execution block. Bot will exit.", e);
      process.exit(1); // Exit on unhandled top-level error
    }
  })();
};

main();
