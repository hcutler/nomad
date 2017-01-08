const R = require('ramda')
const MessageHeaderCache = require('../local-state').MessageHeaderCache
const MessageHeaderWarehouse = require('./message-header-warehouse')
const util = require('util')

// when a new header comes in, follow prev links and deliver
// older messages not yet delivered up to this many
const ITERATION_LIMIT = 1000000

// register callback with flood sub
// get new message
// add to warehouse
// add to cache

class Subscription {
	constructor(id, ipfs, streamHeadState, newHeaderCallback) {
		this.id = id
		this.ipfs = ipfs
		// tracks which messages have been delivered to user
		this.setHead = (obj) => {
			return streamHeadState.setHeadForStream(this.id, obj)
		}
		this.getHead = () => {
			return streamHeadState.getHeadForStream(this.id)
		}
		this.newHeaderCallback = newHeaderCallback
		this.cache = new MessageHeaderCache(ipfs)

		// need this b/c this function will be called by warehouse
		// which will have it's this not this class' this
		this.processMessageHeader = this.processMessageHeader.bind(this)
		this.recursiveFetchHeader = this.recursiveFetchHeader.bind(this)
		this.warehouse = new MessageHeaderWarehouse(this.processMessageHeader)
		
		this.iterationLimit = ITERATION_LIMIT
	}

	start() {
		return this.ipfs.pubsub.subscribe(this.id, (pubsubMessage) => {
			const header = this.decodePubsubMessage(pubsubMessage)
			this.warehouse.addMessageHeader(header)
			this.cache.addMessageHeader(header.multihash, header)
		})
	}

	recursiveFetchHeader(header, lastDeliveredHeader, deliveryQueue) {
		// delete from the cache because we're dealing with it
		this.cache.deleteMessageHeader(header.multihash)
		
		// base cases, end recursion
		// too many iterations
		if (deliveryQueue.length > this.iterationLimit) {
			return Promise.resolve(deliveryQueue)
		}

		// no more previous headers that we haven't processed
		if (header.multihash === lastDeliveredHeader.multihash) {
			return Promise.resolve(deliveryQueue)
		}

		// header is new so add to queue
		const prepended = R.prepend(header, deliveryQueue)

		// header is a new root message
		const prevHeaderLinkObj = (R.find(R.propEq('name', 'prev'))(header.links))
		if (R.isNil(prevHeaderLinkObj)) {
			return Promise.resolve(prepended)
		}

		// this will fetch from the cache or network as needed
		return this.cache.getMessageHeader(prevHeaderLinkObj.multihash)
			.then((prevHeader) => {
				return this.recursiveFetchHeader(prevHeader, lastDeliveredHeader, prepended)
			})
	}

	processMessageHeader(header) {
		return this.getHead()
			.then((lastDeliveredHeader) => {
				if (lastDeliveredHeader && lastDeliveredHeader.data.idx >= header.data.idx) {
					// we've seen this message before
					return Promise.resolve(null)
				}

				// haven't seen this header before
				if (R.isNil(lastDeliveredHeader)) {
					// this is a new subscription for this node and this is first message
					// don't fetch previous messages, just deliver this one
					return this.setHead(header)
						.then(() => {
							this.newHeaderCallback(header)
							return Promise.resolve(null)
						})
				}

				// fetch messages between lastDeliveredHeader through header and deliver
				return this.setHead(header)
					.then(() => {
						return this.recursiveFetchHeader(header, lastDeliveredHeader, [])
					})
					.then((deliveryQueue) => {
						R.forEach((header) => {
							this.newHeaderCallback(header)
						}, deliveryQueue)
						return Promise.resolve(null)
					})
			})
	}

	decodePubsubMessage(pubsubMessage) {
		return JSON.parse(pubsubMessage.data.toString())
	}
}

module.exports = Subscription