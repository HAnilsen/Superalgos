exports.newTradingExecution = function newTradingExecution(bot, logger, tradingEngineModule) {
    /*
    The Trading Execution modules manages the execution of orders against the exchanges.
    */
    const MODULE_NAME = 'Trading Execution'

    let thisObject = {
        checkExecution: checkExecution,
        initialize: initialize,
        finalize: finalize
    }

    let tradingEngine
    let tradingSystem
    let sessionParameters

    const EXCHANGE_API_MODULE = require('./ExchangeAPI.js')
    let exchangeAPIModule = EXCHANGE_API_MODULE.newExchangeAPI(bot, logger)

    const ANNOUNCEMENTS_MODULE = require('./Announcements.js')
    let announcementsModule = ANNOUNCEMENTS_MODULE.newAnnouncements(bot, logger)

    return thisObject

    function initialize() {
        tradingSystem = bot.simulationState.tradingSystem
        tradingEngine = bot.simulationState.tradingEngine
        sessionParameters = bot.SESSION.parameters

        exchangeAPIModule.initialize()
        announcementsModule.initialize()
    }

    function finalize() {
        tradingSystem = undefined
        tradingEngine = undefined
        sessionParameters = undefined

        exchangeAPIModule.finalize()
        exchangeAPIModule = undefined

        announcementsModule.finalize()
        announcementsModule = undefined
    }

    async function checkExecution(
        executionNode,
        stageIsOpening,
        stageIsClosing,
        stageSizeLimitInBaseAsset,
        stageSizeLimitInQuotedAsset,
        tradingEngineStage
    ) {

        /* Trading Stage Validations */
        if (tradingEngineStage.stageBaseAsset === undefined) { return }
        if (tradingEngineStage.stageBaseAsset.size === undefined) { return }
        if (tradingEngineStage.stageBaseAsset.sizeFilled === undefined) { return }
        if (tradingEngineStage.stageBaseAsset.amountReceived === undefined) { return }
        if (tradingEngineStage.stageBaseAsset.feesPaid === undefined) { return }
        if (tradingEngineStage.stageQuotedAsset === undefined) { return }
        if (tradingEngineStage.stageQuotedAsset.size === undefined) { return }
        if (tradingEngineStage.stageQuotedAsset.sizeFilled === undefined) { return }
        if (tradingEngineStage.stageQuotedAsset.amountReceived === undefined) { return }
        if (tradingEngineStage.stageQuotedAsset.feesPaid === undefined) { return }

        /* 
        The user choice of asset to define the size of the position,
        defines the asset that will track the information kept about the 
        stage at the trading engine data structure. We set this asset
        to be used here in this way:
        */
        let tradingEngineStageAsset
        if (tradingEngine.current.position.positionBaseAsset.size.value > 0) {
            tradingEngineStageAsset = tradingEngineStage.stageBaseAsset
        } else {
            tradingEngineStageAsset = tradingEngineStage.stageQuotedAsset
        }
        /*
        The asset type of the position size chosen by the user, also defines 
        the stage limit to be on the same asset type.
        */
        let stageSizeLimit
        if (tradingEngine.current.position.positionBaseAsset.size.value > 0) {
            stageSizeLimit = stageSizeLimitInBaseAsset
        } else {
            stageSizeLimit = stageSizeLimitInQuotedAsset
        }

        await checkExecutionAlgorithms(executionNode)

        async function checkExecutionAlgorithms(executionNode) {
            for (let i = 0; i < executionNode.executionAlgorithms.length; i++) {
                let executionAlgorithm = executionNode.executionAlgorithms[i]
                await checkOrders(executionAlgorithm.marketBuyOrders, executionAlgorithm, executionNode)
                await checkOrders(executionAlgorithm.marketSellOrders, executionAlgorithm, executionNode)
                await checkOrders(executionAlgorithm.limitBuyOrders, executionAlgorithm, executionNode)
                await checkOrders(executionAlgorithm.limitSellOrders, executionAlgorithm, executionNode)
            }
        }

        async function checkOrders(orders, executionAlgorithm, executionNode) {
            for (let i = 0; i < orders.length; i++) {

                let tradingSystemOrder = orders[i]

                /* Trading System Validations */
                if (tradingSystemOrder.config.positionSizePercentage === undefined) { continue }
                if (tradingSystemOrder.referenceParent === undefined) { continue }

                let tradingEngineOrder = tradingEngineModule.getNodeById(tradingSystemOrder.referenceParent.id)

                /* Trading Engine Validations */
                if (tradingEngineOrder.serialNumber === undefined) { continue }
                if (tradingEngineOrder.identifier === undefined) { continue }
                if (tradingEngineOrder.exchangeId === undefined) { continue }
                if (tradingEngineOrder.begin === undefined) { continue }
                if (tradingEngineOrder.end === undefined) { continue }
                if (tradingEngineOrder.rate === undefined) { continue }
                if (tradingEngineOrder.status === undefined) { continue }
                if (tradingEngineOrder.algorithmName === undefined) { continue }
                if (tradingEngineOrder.orderCounters === undefined) { continue }
                if (tradingEngineOrder.orderCounters.periods === undefined) { continue }
                if (tradingEngineOrder.orderStatistics.days === undefined) { continue }
                if (tradingEngineOrder.orderStatistics.percentageFilled === undefined) { continue }
                if (tradingEngineOrder.orderStatistics.actualRate === undefined) { continue }
                if (tradingEngineOrder.orderStatistics.feesPaid === undefined) { continue }

                if (tradingEngineOrder.orderBaseAsset.size === undefined) { continue }
                if (tradingEngineOrder.orderBaseAsset.sizeFilled === undefined) { continue }
                if (tradingEngineOrder.orderBaseAsset.amountReceived === undefined) { continue }
                if (tradingEngineOrder.orderBaseAsset.feesPaid === undefined) { continue }

                if (tradingEngineOrder.orderQuotedAsset.size === undefined) { continue }
                if (tradingEngineOrder.orderQuotedAsset.sizeFilled === undefined) { continue }
                if (tradingEngineOrder.orderQuotedAsset.amountReceived === undefined) { continue }
                if (tradingEngineOrder.orderQuotedAsset.feesPaid === undefined) { continue }

                /*
                The asset type of the position size chosen by the user, defines 
                the asset at the order data strutcture where information is going to 
                be stored.
                */
                let traingEngineOrderAsset
                if (tradingEngine.current.position.positionBaseAsset.size.value > 0) {
                    traingEngineOrderAsset = tradingEngineOrder.orderBaseAsset
                } else {
                    traingEngineOrderAsset = tradingEngineOrder.orderQuotedAsset
                }

                switch (tradingEngineOrder.status.value) {
                    case 'Not Open': {
                        {
                            /* When the stage is closing we can not create new orders */
                            if (stageIsClosing === true) { continue }
                            /* 
                            Check if we can create an order based on the config value for spawnMultipleOrders.
                            Trading System Orders that cannot spawn more than one Trading Engine Order needs to check if
                            at the Trading Engine Order the lock is Open or Closed. 
                            */
                            if (tradingSystemOrder.config.spawnMultipleOrders !== true) {
                                if (tradingEngineOrder.identifier.value === 'Closed') {
                                    continue
                                }
                            }
                            /* Check if we need to Create this Order */
                            let situationName = checkOrderEvent(tradingSystemOrder.createOrderEvent, tradingSystemOrder, executionAlgorithm, executionNode)
                            if (situationName !== undefined) {

                                /* Open a new order */
                                await tryToOpenOrder(executionAlgorithm, tradingSystemOrder, tradingEngineOrder, situationName)
                            }
                        }
                        break
                    }
                    case 'Open': {
                        /* Update this order properties */
                        tradingEngineOrder.end.value = tradingEngine.current.candle.end.value
                        tradingEngineOrder.orderCounters.periods.value++
                        tradingEngineOrder.orderStatistics.days.value = tradingEngineOrder.orderCounters.periods.value * sessionParameters.timeFrame.config.value / global.ONE_DAY_IN_MILISECONDS

                        /* Simulate Events that happens at the Exchange, if needed. */
                        simulateExchangeEvents(tradingSystemOrder, tradingEngineOrder)

                        /* Check Events that happens at the Exchange, if needed. */
                        await checkExchangeEvents(tradingSystemOrder, tradingEngineOrder)

                        /* 
                        In the previous steps, we might have discovered that the order was cancelled 
                        at the exchange, or filled, so  the order might still not be Open. 
                        If the stage is closing or the order is not Open, we wont be cancelling orders 
                        based on defined events. 
                        */
                        if (stageIsClosing !== true && tradingEngineOrder.status.value === 'Open') {

                            /* Check if we need to Cancel this Order */
                            let situationName = checkOrderEvent(tradingSystemOrder.cancelOrderEvent, tradingSystemOrder, executionAlgorithm, executionNode)
                            if (situationName !== undefined) {

                                /* Simulate Order Cancelation, if needed. */
                                simulateCancelOrder(tradingSystemOrder, tradingEngineOrder, 'Cancel Event')

                                /* Cancel the order at the Exchange, if needed. */
                                await exchangeCancelOrder(tradingSystemOrder, tradingEngineOrder, 'Cancel Event')
                            }
                        }
                    }
                }
            }
        }

        async function tryToOpenOrder(executionAlgorithm, tradingSystemOrder, tradingEngineOrder, situationName) {

            calculateOrderRate()
            calculateOrderSize()

            /* Check Size: We are not going to create Orders which size is equal or less to zero.  */
            if (traingEngineOrderAsset.size.value <= 0) { return }

            /* Place Order at the Exchange, if needed. */
            let result = await createOrderAtExchange(tradingSystemOrder, tradingEngineOrder)
            if (result !== true) { return }

            /* Update Stage Size */
            tradingEngineStage.stageBaseAsset.size.value = tradingEngineStage.stageBaseAsset.size.value + tradingEngineOrder.orderBaseAsset.size.value
            tradingEngineStage.stageBaseAsset.size.value = global.PRECISE(tradingEngineStage.stageBaseAsset.size.value, 10)
            tradingEngineStage.stageQuotedAsset.size.value = tradingEngineStage.stageQuotedAsset.size.value + tradingEngineOrder.orderQuotedAsset.size.value
            tradingEngineStage.stageQuotedAsset.size.value = global.PRECISE(tradingEngineStage.stageQuotedAsset.size.value, 10)

            /* Updating Episode Counters */
            tradingEngine.episode.episodeCounters.orders.value++

            /* Initialize this */
            tradingEngine.current.distanceToEvent.createOrder.value = 1

            /* Create Order Procedure */
            tradingEngineOrder.status.value = 'Open'
            tradingEngineOrder.identifier.value = global.UNIQUE_ID()
            tradingEngineOrder.begin.value = tradingEngine.current.candle.begin.value
            tradingEngineOrder.end.value = tradingEngine.current.candle.end.value
            tradingEngineOrder.serialNumber.value = tradingEngine.episode.episodeCounters.orders.value
            tradingEngineOrder.orderName.value = tradingSystemOrder.name
            tradingEngineOrder.algorithmName.value = executionAlgorithm.name
            tradingEngineOrder.situationName.value = situationName

            function calculateOrderRate() {
                /* Order Rate Calculation */
                tradingEngineOrder.rate.value = tradingEngine.current.position.rate.value // By default this is the order rate.
                if (tradingSystemOrder.positionRate !== undefined) {
                    if (tradingSystemOrder.positionRate.formula !== undefined) {
                        tradingEngineOrder.rate.value = tradingSystem.formulas.get(tradingSystemOrder.positionRate.formula.id)

                        if (tradingEngineOrder.rate.value === undefined) {
                            const errorText = 'Rate cannot be undefined. Fix this please.'
                            tradingSystem.errors.push([tradingSystemOrder.positionRate.formula.id, errorText])
                            throw (errorText)
                        }

                        if (tradingEngineOrder.rate.value <= 0) {
                            const errorText = 'Rate cannot be less or equal to zero. Fix this please.'
                            tradingSystem.errors.push([tradingSystemOrder.positionRate.formula.id, errorText])
                            throw (errorText)
                        }
                        tradingEngineOrder.rate.value = global.PRECISE(tradingEngineOrder.rate.value, 10)
                    }
                }
            }

            function calculateOrderSize() {
                /* 
                 If the position size was defined in Base Asset, then 
                 the algorithm needs to define its size also in Base Asset. 
                 The same if it was deined in Quoted Asset.
                 */
                let sizeFormula
                if (tradingEngine.current.position.positionBaseAsset.size.value > 0) {
                    /* Position was defined in Base Asset */
                    if (executionAlgorithm.sizeInBaseAsset !== undefined) {
                        if (executionAlgorithm.sizeInBaseAsset.formula !== undefined) {
                            sizeFormula = executionAlgorithm.sizeInBaseAsset.formula
                        } else {
                            const errorText = 'Size In Base Asset needs a child Formula. Fix this please.'
                            tradingSystem.errors.push([executionAlgorithm.sizeInBaseAsset.id, errorText])
                            throw (errorText)
                        }
                    } else {
                        const errorText = 'Execution Algorithm needs a child Size In Base Asset. Fix this please.'
                        tradingSystem.errors.push([executionAlgorithm.id, errorText])
                        throw (errorText)
                    }
                } else {
                    /* Position was defined in Quoted Asset */
                    if (executionAlgorithm.sizeInQuotedAsset !== undefined) {
                        if (executionAlgorithm.sizeInQuotedAsset.formula !== undefined) {
                            sizeFormula = executionAlgorithm.sizeInQuotedAsset.formula
                        } else {
                            const errorText = 'Size In Quoted Asset needs a child Formula. Fix this please.'
                            tradingSystem.errors.push([executionAlgorithm.sizeInQuotedAsset.id, errorText])
                            throw (errorText)
                        }
                    } else {
                        const errorText = 'Execution Algorithm needs a child Size In Quoted Asset. Fix this please.'
                        tradingSystem.errors.push([executionAlgorithm.id, errorText])
                        throw (errorText)
                    }
                }

                /* Order Size Calculation */
                let algorithmSize = tradingSystem.formulas.get(sizeFormula.id)
                if (algorithmSize === undefined) {
                    const errorText = 'Execution Algorithm Size cannot be undefined. Fix this please.'
                    tradingSystem.errors.push([sizeFormula.id, errorText])
                    throw (errorText)
                }

                /* Validate that this config exists */
                if (tradingSystemOrder.config.positionSizePercentage === undefined) {
                    const errorText = 'Config positionSizePercentage does not exist. Fix this please.'
                    tradingSystem.errors.push([tradingSystemOrder.id, errorText])
                    throw (errorText)
                }

                traingEngineOrderAsset.size.value = algorithmSize * tradingSystemOrder.config.positionSizePercentage / 100
                traingEngineOrderAsset.size.value = global.PRECISE(traingEngineOrderAsset.size.value, 10)

                /* Check against the Stage Size Limit */
                if (
                    tradingEngineStageAsset.size.value + traingEngineOrderAsset.size.value > stageSizeLimit.value) {
                    /* We reduce the size to the remaining size of the position. */
                    traingEngineOrderAsset.size.value = stageSizeLimit.value - tradingEngineStageAsset.value
                    traingEngineOrderAsset.size.value = global.PRECISE(traingEngineOrderAsset.size.value, 10)
                }

                /* We are going to ESTIMATE the size in the oposite asset type, because we will need it later */
                switch (traingEngineOrderAsset.type) {
                    case 'Order Base Asset': {
                        tradingEngineOrder.orderQuotedAsset.size = tradingEngineOrder.orderBaseAsset.size * tradingEngineOrder.rate
                        tradingEngineOrder.size.value = global.PRECISE(tradingEngineOrder.size.value, 10)
                    }
                    case 'Order Quoted Asset': {
                        tradingEngineOrder.orderBaseAsset.size = tradingEngineOrder.orderQuotedAsset.size / tradingEngineOrder.rate
                        tradingEngineOrder.size.value = global.PRECISE(tradingEngineOrder.size.value, 10)
                    }
                }
            }

            async function createOrderAtExchange(tradingSystemOrder, tradingEngineOrder) {

                /* Filter by Session Type */
                switch (bot.SESSION.type) {
                    case 'Backtesting Session': {
                        return true
                    }
                    case 'Live Trading Session': {
                        break
                    }
                    case 'Fordward Testing Session': {
                        break
                    }
                    case 'Paper Trading Session': {
                        return true
                    }
                }

                let orderId = await exchangeAPIModule.createOrder(tradingSystemOrder, tradingEngineOrder)

                if (orderId !== undefined) {
                    tradingEngineOrder.exchangeId.value = orderId
                    return true
                }
            }
        }

        function simulateExchangeEvents(tradingSystemOrder, tradingEngineOrder) {

            /* Filter by Session Type */
            switch (bot.SESSION.type) {
                case 'Backtesting Session': {
                    break
                }
                case 'Live Trading Session': {
                    return
                }
                case 'Fordward Testing Session': {
                    return
                }
                case 'Paper Trading Session': {
                    break
                }
            }

            /* Filter by what is defined at the Strategy */
            if (tradingSystemOrder.simulatedExchangeEvents === undefined) { return }

            let previousBaseAssetSizeFilled = tradingEngineOrder.orderBaseAsset.sizeFilled.value
            let previousQuotedAssetSizeFilled = tradingEngineOrder.orderQuotedAsset.sizeFilled.value
            let previousBaseAssetFeesPaid = tradingEngineOrder.orderBaseAsset.feesPaid.value
            let previousQuotedAssetFeesPaid = tradingEngineOrder.orderQuotedAsset.feesPaid.value

            actualRateSimulation()
            feesPaidSimulation()
            percentageFilledSimulation()
            sizeFilledSimulation()

            doTheAccounting(
                tradingSystemOrder,
                tradingEngineOrder,
                previousBaseAssetSizeFilled,
                previousQuotedAssetSizeFilled,
                previousBaseAssetFeesPaid,
                previousQuotedAssetFeesPaid
            )

            /* If the Stage is Closing and this order is still open, we need to cancel it now */
            if (stageIsClosing === true && tradingEngineOrder.status.value !== 'Closed') {
                simulateCancelOrder(tradingSystemOrder, tradingEngineOrder, 'Closing Stage')
            }

            function actualRateSimulation() {
                /* Actual Rate Simulation */
                let calculatedBasedOnTradingSystem = false

                /* Based on the Trading System Definition */
                if (tradingSystemOrder.simulatedExchangeEvents.simulatedActualRate !== undefined) {
                    if (tradingSystemOrder.simulatedExchangeEvents.simulatedActualRate.formula !== undefined) {
                        /* Calculate this only once for this order */
                        if (tradingEngineOrder.orderStatistics.actualRate.value === tradingEngineOrder.orderStatistics.actualRate.config.initialValue) {
                            tradingEngineOrder.orderStatistics.actualRate.value = tradingSystem.formulas.get(tradingSystemOrder.simulatedExchangeEvents.simulatedActualRate.formula.id)
                            if (tradingEngineOrder.orderStatistics.actualRate.value !== undefined) {
                                calculatedBasedOnTradingSystem = true
                            }
                        }
                    }
                }

                /* Based on the Session Parameters Definition */
                if (calculatedBasedOnTradingSystem === false) {
                    switch (tradingEngineOrder.type) {
                        case 'Market Order': {
                            /* Actual Rate is simulated based on the Session Paremeters */
                            let slippageAmount = tradingEngineOrder.rate.value * bot.SESSION.parameters.slippage.config.positionRate / 100
                            switch (tradingSystemOrder.type) {
                                case 'Market Sell Order': {
                                    tradingEngineOrder.orderStatistics.actualRate.value = tradingEngineOrder.rate.value - slippageAmount
                                    break
                                }
                                case 'Market Buy Order': {
                                    tradingEngineOrder.orderStatistics.actualRate.value = tradingEngineOrder.rate.value + slippageAmount
                                    break
                                }
                            }
                            break
                        }
                        case 'Limit Order': {
                            /* In Limit Orders the actual rate is the rate of the order, there is no slippage */
                            tradingEngineOrder.orderStatistics.actualRate.value = tradingEngineOrder.rate.value
                            break
                        }
                    }
                }
                tradingEngineOrder.orderStatistics.actualRate.value = global.PRECISE(tradingEngineOrder.orderStatistics.actualRate.value, 10)
            }

            function feesPaidSimulation() {
                /* Fees Paid Simulation */
                let calculatedBasedOnTradingSystem = false

                /* Based on the Trading System Definition */
                if (tradingSystemOrder.simulatedExchangeEvents.simulatedFeesPaid !== undefined) {
                    if (tradingSystemOrder.simulatedExchangeEvents.simulatedFeesPaid.config.percentage !== undefined) {
                        if (tradingEngineOrder.orderBaseAsset.feesPaid.value === tradingEngineOrder.orderBaseAsset.feesPaid.config.initialValue) {

                            tradingEngineOrder.orderBaseAsset.feesPaid.value =
                                tradingEngineOrder.orderBaseAsset.size.value *
                                tradingSystemOrder.simulatedExchangeEvents.simulatedFeesPaid.config.percentage / 100

                            calculatedBasedOnTradingSystem = true
                        }

                        if (tradingEngineOrder.orderQuotedAsset.feesPaid.value === tradingEngineOrder.orderQuotedAsset.feesPaid.config.initialValue) {

                            tradingEngineOrder.orderQuotedAsset.feesPaid.value =
                                tradingEngineOrder.orderQuotedAsset.size.value *
                                tradingSystemOrder.simulatedExchangeEvents.simulatedFeesPaid.config.percentage / 100

                            calculatedBasedOnTradingSystem = true
                        }
                    }
                }

                /* Based on the Session Parameters Definition */
                if (calculatedBasedOnTradingSystem === false) {
                    /* Fees are simulated based on the Session Paremeters */
                    switch (tradingEngineOrder.type) {
                        case 'Market Order': {

                            tradingEngineOrder.orderBaseAsset.feesPaid.value =
                                tradingEngineOrder.orderBaseAsset.size.value *
                                bot.SESSION.parameters.feeStructure.config.taker / 100

                            tradingEngineOrder.orderQuotedAsset.feesPaid.value =
                                tradingEngineOrder.orderQuotedAsset.size.value *
                                bot.SESSION.parameters.feeStructure.config.taker / 100

                            break
                        }
                        case 'Limit Order': {

                            tradingEngineOrder.orderBaseAsset.feesPaid.value =
                                tradingEngineOrder.orderBaseAsset.size.value *
                                bot.SESSION.parameters.feeStructure.config.maker / 100

                            tradingEngineOrder.orderQuotedAsset.feesPaid.value =
                                tradingEngineOrder.orderQuotedAsset.size.value *
                                bot.SESSION.parameters.feeStructure.config.maker / 100

                            break
                        }
                    }
                }
                tradingEngineOrder.orderBaseAsset.feesPaid.value = global.PRECISE(tradingEngineOrder.orderBaseAsset.feesPaid.value, 10)
                tradingEngineOrder.orderQuotedAsset.feesPaid.value = global.PRECISE(tradingEngineOrder.orderQuotedAsset.feesPaid.value, 10)
            }

            function percentageFilledSimulation() {
                /* Order Filling Simulation */
                if (tradingSystemOrder.simulatedExchangeEvents.simulatedPartialFill !== undefined) {
                    if (tradingSystemOrder.simulatedExchangeEvents.simulatedPartialFill.config.fillProbability !== undefined) {

                        /* Percentage Filled */
                        let percentageFilled = tradingSystemOrder.simulatedExchangeEvents.simulatedPartialFill.config.fillProbability * 100
                        if (tradingEngineOrder.orderStatistics.percentageFilled.value + percentageFilled > 100) {
                            percentageFilled = 100 - tradingEngineOrder.orderStatistics.percentageFilled.value
                        }
                        tradingEngineOrder.orderStatistics.percentageFilled.value = tradingEngineOrder.orderStatistics.percentageFilled.value + percentageFilled
                        tradingEngineOrder.orderStatistics.percentageFilled.value = global.PRECISE(tradingEngineOrder.orderStatistics.percentageFilled.value, 10)

                        /* Check if we need to close */
                        if (tradingEngineOrder.orderStatistics.percentageFilled.value === 100) {

                            /* Close this Order */
                            tradingEngineOrder.status.value = 'Closed'
                            tradingEngineOrder.exitType.value = 'Filled'

                            /* Initialize this */
                            tradingEngine.current.distanceToEvent.closeOrder.value = 1
                        }
                    }
                }
            }

            function sizeFilledSimulation() {
                /* Size Filled */
                tradingEngineOrder.orderBaseAsset.sizeFilled.value =
                    tradingEngineOrder.orderBaseAsset.size.value *
                    tradingEngineOrder.orderStatistics.percentageFilled.value / 100

                tradingEngineOrder.orderQuotedAsset.sizeFilled.value =
                    tradingEngineOrder.orderQuotedAsset.size.value *
                    tradingEngineOrder.orderStatistics.percentageFilled.value / 100

                tradingEngineOrder.orderBaseAsset.sizeFilled.value = global.PRECISE(tradingEngineOrder.orderBaseAsset.sizeFilled.value, 10)
                tradingEngineOrder.orderQuotedAsset.sizeFilled.value = global.PRECISE(tradingEngineOrder.orderQuotedAsset.sizeFilled.value, 10)
            }
        }

        async function checkExchangeEvents(tradingSystemOrder, tradingEngineOrder) {

            /* Filter by Session Type */
            switch (bot.SESSION.type) {
                case 'Backtesting Session': {
                    return true
                }
                case 'Live Trading Session': {
                    break
                }
                case 'Fordward Testing Session': {
                    break
                }
                case 'Paper Trading Session': {
                    return true
                }
            }

            let order = await exchangeAPIModule.getOrder(tradingSystemOrder, tradingEngineOrder)

            if (order === undefined) { return }

            const AT_EXCHANGE_STATUS = {
                OPEN: 'open',
                CLOSED: 'closed',
                CANCELLED: 'canceled'
            }

            /* Status Checks */
            if (order.remaining === 0 && order.status === AT_EXCHANGE_STATUS.CLOSED) {

                /* Close this Order */
                tradingEngineOrder.status.value = 'Closed'
                tradingEngineOrder.exitType.value = 'Filled'

                /* Initialize this */
                tradingEngine.current.distanceToEvent.closeOrder.value = 1
            }
            if (order.remaining > 0 && order.status === AT_EXCHANGE_STATUS.CLOSED) {

                /* Close this Order */
                tradingEngineOrder.status.value = 'Closed'
                tradingEngineOrder.exitType.value = 'Closed at the Exchange'

                /* Initialize this */
                tradingEngine.current.distanceToEvent.closeOrder.value = 1
            }
            if (order.status === AT_EXCHANGE_STATUS.CANCELLED) {

                /* Close this Order */
                tradingEngineOrder.status.value = 'Closed'
                tradingEngineOrder.exitType.value = 'Cancelled at the Exchange'

                /* Initialize this */
                tradingEngine.current.distanceToEvent.closeOrder.value = 1
            }

            syncWithExchange(tradingSystemOrder, tradingEngineOrder, order)

            /* Forced Cancellation Check */
            if (stageIsClosing === true && tradingEngineOrder.status.value !== 'Closed') {
                await exchangeCancelOrder(tradingSystemOrder, tradingEngineOrder, 'Closing Stage')
            }
        }

        function syncWithExchange(tradingSystemOrder, tradingEngineOrder, order) {

            let previousBaseAssetSizeFilled = tradingEngineOrder.orderBaseAsset.sizeFilled.value
            let previousQuotedAssetSizeFilled = tradingEngineOrder.orderQuotedAsset.sizeFilled.value
            let previousBaseAssetFeesPaid = tradingEngineOrder.orderBaseAsset.feesPaid.value
            let previousQuotedAssetFeesPaid = tradingEngineOrder.orderQuotedAsset.feesPaid.value

            /* Actual Rate Calculation */
            tradingEngineOrder.orderStatistics.actualRate.value = order.price
            tradingEngineOrder.orderStatistics.actualRate.value = global.PRECISE(tradingEngineOrder.orderStatistics.actualRate.value, 10)

            /* Fees Paid Calculation */
            /*
            As a response from the exchange we can not always get the fees. 
            For that reason we need to estimate them base of the information that we do have.
            CCXT provides order.amount which represents the size we set for the order minus the
            fees taken by the exchange, all denominated in Base Asset. 
            In this way if we substract to the order size this order.amount
            we can get the fees. All this is denominated in base asset because that is how CCXT works.
            The fees then can be estimated in Quoted Asset using the Actual Rate.
            */
            tradingEngineOrder.orderBaseAsset.feesPaid.value = tradingEngineOrder.orderBaseAsset.size.value - order.amount
            tradingEngineOrder.orderBaseAsset.feesPaid.value = global.PRECISE(tradingEngineOrder.orderBaseAsset.feesPaid.value, 10)
            tradingEngineOrder.orderQuotedAsset.feesPaid.value = tradingEngineOrder.orderBaseAsset.feesPaid.value * tradingEngineOrder.orderStatistics.actualRate.value
            tradingEngineOrder.orderQuotedAsset.feesPaid.value = global.PRECISE(tradingEngineOrder.orderQuotedAsset.feesPaid.value, 10)

            /* Percentage Filled Calculation */
            tradingEngineOrder.orderStatistics.percentageFilled.value = order.filled * 100 / (order.filled + order.remaining)
            tradingEngineOrder.orderStatistics.percentageFilled.value = global.PRECISE(tradingEngineOrder.orderStatistics.percentageFilled.value, 10)

            /* Size Filled Calculation */
            /* 
            CCXT returns order.filled with an amount denominated in Base Asset. We will
            take it from there for our Order Base Asset. For our Order Quoted Asset we 
            will use the field order.cost.
            */
            tradingEngineOrder.orderBaseAsset.sizeFilled.value = order.filled
            tradingEngineOrder.orderBaseAsset.sizeFilled.value = global.PRECISE(tradingEngineOrder.orderBaseAsset.sizeFilled.value, 10)
            tradingEngineOrder.orderQuotedAsset.sizeFilled.value = order.cost
            tradingEngineOrder.orderQuotedAsset.sizeFilled.value = global.PRECISE(tradingEngineOrder.orderQuotedAsset.sizeFilled.value, 10)

            doTheAccounting(
                tradingSystemOrder,
                tradingEngineOrder,
                previousBaseAssetSizeFilled,
                previousQuotedAssetSizeFilled,
                previousBaseAssetFeesPaid,
                previousQuotedAssetFeesPaid
            )
        }

        function doTheAccounting(
            tradingSystemOrder,
            tradingEngineOrder,
            previousBaseAssetSizeFilled,
            previousQuotedAssetSizeFilled,
            previousBaseAssetFeesPaid,
            previousQuotedAssetFeesPaid
        ) {

            updateStageAssets()
            updateBalances()

            function updateStageAssets() {
                /* Stage Base Asset: Undo the previous accounting */
                tradingEngineStage.stageBaseAsset.sizeFilled.value =
                    tradingEngineStage.stageBaseAsset.value -
                    previousBaseAssetSizeFilled

                tradingEngineStage.stageBaseAsset.feesPaid.value =
                    tradingEngineStage.feesPaid.value -
                    previousBaseAssetFeesPaid

                /* Stage Base Asset: Account the current filling and fees */
                tradingEngineStage.stageBaseAsset.sizeFilled.value =
                    tradingEngineStage.stageBaseAsset.value +
                    tradingEngineOrder.orderBaseAsset.sizeFilled.value

                tradingEngineStage.stageBaseAsset.feesPaid.value =
                    tradingEngineStage.feesPaid.value +
                    tradingEngineOrder.orderBaseAsset.feesPaid.value

                /* Stage Quote Asset: Undo the previous accounting */
                tradingEngineStage.stageQuotedAsset.sizeFilled.value =
                    tradingEngineStage.stageQuotedAsset.value -
                    previousQuotedAssetSizeFilled

                tradingEngineStage.stageQuotedAsset.feesPaid.value =
                    tradingEngineStage.feesPaid.value -
                    previousQuotedAssetFeesPaid

                /* Stage Quote Asset: Account the current filling and fees */
                tradingEngineStage.stageQuotedAsset.sizeFilled.value =
                    tradingEngineStage.stageQuotedAsset.value +
                    tradingEngineOrder.orderQuotedAsset.sizeFilled.value

                tradingEngineStage.stageQuotedAsset.feesPaid.value =
                    tradingEngineStage.feesPaid.value +
                    tradingEngineOrder.orderQuotedAsset.feesPaid.value

                tradingEngineStage.stageBaseAsset.sizeFilled.value = global.PRECISE(tradingEngineStage.stageBaseAsset.sizeFilled.value, 10)
                tradingEngineStage.stageBaseAsset.feesPaid.value = global.PRECISE(tradingEngineStage.stageBaseAsset.feesPaid.value, 10)

                tradingEngineStage.stageQuotedAsset.sizeFilled.value = global.PRECISE(tradingEngineStage.stageQuotedAsset.sizeFilled.value, 10)
                tradingEngineStage.stageQuotedAsset.feesPaid.value = global.PRECISE(tradingEngineStage.stageQuotedAsset.feesPaid.value, 10)
            }

            function updateBalances() {
                /* Balances Update */
                switch (true) {
                    case tradingSystemOrder.type === 'Market Buy Order' || tradingSystemOrder.type === 'Limit Buy Order': {

                        /* Balance Base Asset: Undo the previous accounting */
                        tradingEngine.current.balance.baseAsset.value =
                            tradingEngine.current.balance.baseAsset.value -
                            previousBaseAssetSizeFilled

                        /* Balance Base Asset: Account the current filling and fees */
                        tradingEngine.current.balance.baseAsset.value =
                            tradingEngine.current.balance.baseAsset.value +
                            tradingEngineOrder.orderBaseAsset.sizeFilled.value

                        /* Balance Quoted Asset: Undo the previous accounting */
                        tradingEngine.current.balance.quotedAsset.value =
                            tradingEngine.current.balance.quotedAsset.value +
                            previousQuotedAssetSizeFilled +
                            previousQuotedAssetFeesPaid

                        /* Balance Quoted Asset: Account the current filling and fees */
                        tradingEngine.current.balance.quotedAsset.value =
                            tradingEngine.current.balance.quotedAsset.value -
                            tradingEngineOrder.orderQuotedAsset.sizeFilled.value -
                            tradingEngineOrder.orderQuotedAsset.feesPaid.value
                        break
                    }
                    case tradingSystemOrder.type === 'Market Sell Order' || tradingSystemOrder.type === 'Limit Sell Order': {

                        /* Balance Base Asset: Undo the previous accounting */
                        tradingEngine.current.balance.baseAsset.value =
                            tradingEngine.current.balance.baseAsset.value +
                            previousBaseAssetSizeFilled +
                            previousBaseAssetFeesPaid

                        /* Balance Base Asset: Account the current filling and fees */
                        tradingEngine.current.balance.baseAsset.value =
                            tradingEngine.current.balance.baseAsset.value -
                            tradingEngineOrder.orderBaseAsset.sizeFilled.value -
                            tradingEngineOrder.orderBaseAsset.feesPaid.value

                        /* Balance Quoted Asset: Undo the previous accounting */
                        tradingEngine.current.balance.quotedAsset.value =
                            tradingEngine.current.balance.quotedAsset.value -
                            previousQuotedAssetSizeFilled

                        /* Balance Quoted Asset: Account the current filling and fees */
                        tradingEngine.current.balance.quotedAsset.value =
                            tradingEngine.current.balance.quotedAsset.value +
                            tradingEngineOrder.orderQuotedAsset.sizeFilled.value
                        break
                    }
                }
                tradingEngine.current.balance.baseAsset.value = global.PRECISE(tradingEngine.current.balance.baseAsset.value, 10)
                tradingEngine.current.balance.quotedAsset.value = global.PRECISE(tradingEngine.current.balance.quotedAsset.value, 10)
            }

        }

        function simulateCancelOrder(tradingSystemOrder, tradingEngineOrder, exitType) {

            /* Filter by Session Type */
            switch (bot.SESSION.type) {
                case 'Backtesting Session': {
                    break
                }
                case 'Live Trading Session': {
                    return
                }
                case 'Fordward Testing Session': {
                    return
                }
                case 'Paper Trading Session': {
                    break
                }
            }

            /* Close this Order */
            tradingEngineOrder.status.value = 'Closed'
            tradingEngineOrder.exitType.value = exitType

            /* Initialize this */
            tradingEngine.current.distanceToEvent.closeOrder.value = 1

            recalculateStageSize(tradingEngineOrder)
        }

        async function exchangeCancelOrder(tradingSystemOrder, tradingEngineOrder, exitType) {

            /* Filter by Session Type */
            switch (bot.SESSION.type) {
                case 'Backtesting Session': {
                    return
                }
                case 'Live Trading Session': {
                    break
                }
                case 'Fordward Testing Session': {
                    break
                }
                case 'Paper Trading Session': {
                    return
                }
            }

            /* Check if we can cancel the order at the Exchange. */
            let result = await exchangeAPIModule.cancelOrder(tradingSystemOrder, tradingEngineOrder)
            if (result === true) {
                /* Close this Order */
                tradingEngineOrder.status.value = 'Closed'
                tradingEngineOrder.exitType.value = exitType

                /* Initialize this */
                tradingEngine.current.distanceToEvent.closeOrder.value = 1

                /* 
                Perhaps the order was filled a bit more between the last time we checked and when it was cancelled.
                To sync our accounting, we need to check the order one last time and if it changed, fix it.
                */

                let order = await exchangeAPIModule.getOrder(tradingSystemOrder, tradingEngineOrder)

                if (order === undefined) { return }

                syncWithExchange(tradingSystemOrder, tradingEngineOrder, order)

                recalculateStageSize()
            }
        }

        function recalculateStageSize(tradingEngineOrder) {
            /* 
            Since the order is Cancelled, we need to adjust the stage size. Remember that the Stage Size
            accumulates for each asset, the order size placed at the exchange. A cancelation means that 
            only the part filled can be considered placed, so we need to substract from the stage size 
            the remainder. To achieve this with the information we currently have, we are going first 
            to unaccount the order size, and the account only the sizeFilled + the feesPaid.
            */
            tradingEngineStage.stageBaseAsset.size.value =
                tradingEngineStage.stageBaseAsset.size.value -
                tradingEngineOrder.orderBaseAsset.size.value
            tradingEngineStage.stageQuotedAsset.size.value =
                tradingEngineStage.stageQuotedAsset.size.value -
                tradingEngineOrder.orderQuotedAsset.size.value

            tradingEngineStage.stageBaseAsset.size.value =
                tradingEngineStage.stageBaseAsset.size.value +
                tradingEngineOrder.orderBaseAsset.sizeFilled.value +
                tradingEngineOrder.orderBaseAsset.feesPaid.value
            tradingEngineStage.stageQuotedAsset.size.value =
                tradingEngineStage.stageQuotedAsset.size.value +
                tradingEngineOrder.orderQuotedAsset.sizeFilled.value +
                tradingEngineOrder.orderQuotedAsset.feesPaid.value

            tradingEngineStage.stageBaseAsset.size.value = global.PRECISE(tradingEngineStage.stageBaseAsset.size.value, 10)
            tradingEngineStage.stageQuotedAsset.size.value = global.PRECISE(tradingEngineStage.stageQuotedAsset.size.value, 10)
        }

        function checkOrderEvent(event, order, executionAlgorithm, executionNode) {
            if (event !== undefined) {
                for (let k = 0; k < event.situations.length; k++) {
                    let situation = event.situations[k]
                    let passed
                    if (situation.conditions.length > 0) {
                        passed = true
                    }

                    passed = tradingSystem.checkConditions(situation, passed)

                    tradingSystem.values.push([situation.id, passed])
                    if (passed) {
                        tradingSystem.highlights.push(situation.id)
                        tradingSystem.highlights.push(event.id)
                        tradingSystem.highlights.push(order.id)
                        tradingSystem.highlights.push(executionAlgorithm.id)
                        tradingSystem.highlights.push(executionNode.id)

                        announcementsModule.makeAnnoucements(event)
                        return situation.name  // if the event is triggered, we return the name of the situation that passed
                    }
                }
            }
        }
    }
}

