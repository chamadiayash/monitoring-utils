const client = require('prom-client');
const _ = require('lodash');

const logger = require('winston-logstash-transporter')(__filename);

class PromClient {
  static initialize(defaultLabels) {
    // This needs to be initialized only after Log
    if (!logger) throw new Error('Logger not initialized');
    logger.info({
      message: 'Initializing PromClient'
    });
    if (PromClient.client) return PromClient.client;
    const registry = new client.Registry();
    registry.setDefaultLabels(defaultLabels);

    client.collectDefaultMetrics({ register: registry });
    PromClient.client = registry;

    PromClient.collectPromiseRejections();
    return PromClient.client;
  }

  static collectPromiseRejections() {
    process.on('unhandledRejection', (reason) => {
      logger.debug({
        message: 'Unhandled rejection',
        reason: reason,
        stack: reason.stack
      });
      const counter = PromClient.getCounter({ name: 'nodejs_promise_unhandled_rejection_count', help: 'metric_help' });
      counter.inc();
    });

    process.on('rejectionHandled', () => {
      logger.debug({
        message: 'Handled rejection'
      });
      const counter = PromClient.getCounter({ name: 'nodejs_promise_handled_rejection_count', help: 'metric_help' });
      counter.inc();
    });
  }

  static serveExpressMetrics(app, url) {
    if (!PromClient.client) throw new Error('PromClient not initialized');
    logger.debug({
      message: 'getMetrics',
      url
    });
    if (_.isNil(url)) app.get('/metrics', async (req, res) => PromClient.getMetrics(req, res));
    else app.get(url, async (req, res) => PromClient.getMetrics(req, res));
  }

  static async getMetrics(req, res) {
    const resp = await PromClient.client.metrics();
    res.send(resp);
  }

  static expressMiddleware(app, bkts) {
    // Register this before paths
    if (!PromClient.client) throw new Error('PromClient not initialized');
    const buckets = !_.isNil(bkts) ? bkts : [0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 1, 5, 10, 60, 120];
    app.use((req, res, next) => {
      const histogram = PromClient.getHistogram({
        name: 'nodejs_http_request_duration_seconds',
        help: 'metric_help',
        labelNames: ['route'],
        buckets,
      });
      const end = histogram.startTimer();
      const route = req.path;
      const { method } = req;
      res.on('header', () => {
        end({ route, method });
      });
      next();
    });
  }

  static getCounter(config) {
    if (!config || !config.name) throw new Error('Invalid arguments');
    if (!PromClient.client) throw new Error('PromClient not initialized');
    let counter = PromClient.client.getSingleMetric(config.name);
    if (!counter) {
      const newConfig = _.cloneDeep(config);
      newConfig.registers = [PromClient.client];
      counter = new client.Counter(newConfig);
    }
    return counter;
  }

  static getHistogram(config) {
    if (!config || !config.name) throw new Error('Invalid arguments');
    if (!PromClient.client) throw new Error('PromClient not initialized');
    let histogram = PromClient.client.getSingleMetric(config.name);
    if (!histogram) {
      const newConfig = _.cloneDeep(config);
      newConfig.registers = [PromClient.client];
      histogram = new client.Histogram(newConfig);
    }
    return histogram;
  }
}

module.exports = PromClient;
