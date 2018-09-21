const Queue = require('bull')

const { processPullRequests } = require('../sync/pull-request')
const { processCommits } = require('../sync/commits.js')
const { discovery } = require('../sync/discovery')
const app = require('./app')
const getJiraClient = require('../jira/client')

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

// Setup queues
const queues = {
  discovery: new Queue('Content discovery', REDIS_URL),
  pullRequests: new Queue('Pull Requests transformation', REDIS_URL),
  commits: new Queue('Commit transformation', REDIS_URL)
}

// Setup error handling for queues
Object.keys(queues).forEach(name => {
  const queue = queues[name]

  queue.on('error', (err) => {
    app.log.error({err, queue: name})
  })

  queue.on('failed', (job, err) => {
    app.log.error({job, err, queue: name})
  })
})

queues.commits.on('completed', async (job, result) => {
  app.log('commits queue completed for job:', job.id)
  const jiraClient = await getJiraClient(job.id, job.data.installationId, job.data.jiraHost)
  try {
    await jiraClient.devinfo.migration.complete()
  } catch (err) {
    app.log.error(err)
  }
})

module.exports = {
  queues,

  start () {
    queues.pullRequests.process(processPullRequests(app))
    queues.commits.process(processCommits(app))
    queues.discovery.process(discovery(app, queues))

    app.log('Worker process started')
  },

  async stop () {
    return Promise.all([
      queues.pullRequests.close(),
      queues.commits.close(),
      queues.discovery.close()
    ])
  }
}