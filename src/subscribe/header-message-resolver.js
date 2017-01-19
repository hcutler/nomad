/**
 * Resolves message headers to full messages and delivers to user callback.
 * Implemented using a p-queue since we need to make async calls (to ipfs)
 * to look up message data, but want to deliver messages to user in same
 * order that headers are delivered to this object.
 */

 const R = require('ramda')
 const PQueue = require('p-queue')
 const streamToString = require('stream-to-string')

 class HeaderMessageResolver {
  /**
   * @param {function} new message handler.
   */
  constructor (ipfs, handler) {
    this.ipfs = ipfs
    this.handler = handler
    this.queue = new PQueue({concurrency: 1})

    this.deliverMessageForHeader = this.deliverMessageForHeader
    this.fetchAndDeliver = this.fetchAndDeliver
  }

  fetchAndDeliver(header) {
    const dataHash = (R.find(R.propEq('name', 'data'))(header.links)).multihash
    // console.log(this)
    // console.log('===========================================================\n\n\n')
    // console.warn('fetchAndDeliver - header', header)
    // console.warn('fetchAndDeliver - dataHash', dataHash)
    return this.ipfs.files.cat(dataHash)
      .then((stream) => {
        return streamToString(stream)
      })
      .then((message) => {
        this.handler(message)
        return Promise.resolve(null)
      })
  }

  deliverMessageForHeader(header) {
    this.queue.add(() => {
      // console.warn('deliverMessageForHeader - header', header)
      return this.fetchAndDeliver(header)
    })
  }
}

module.exports = HeaderMessageResolver