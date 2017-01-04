const log = require('./utils/log')
// const { getHeadForStream, setHeadForStream } = require('./local-state')

/**
 * TODO:
 * - possibly: local-state should store entire DAG objects to avoid ipfs lookups
 * - make broadcastAndStore 'atomic' even at a basic level
 */

const MODULE_NAME = 'PUBLISH'

module.exports = (self) => {
  /**
   * Create a new publishing head object with the appropriate 'data' link
   *
   * @param {Buffer} buf
   * @returns {Promise} resolves with the newly added DAG object
   */
  const createHead = (buf) => {
    return self._ipfs.files.add(buf)
      .then((files) => {
        return Promise.all([
          self._ipfs.object.new(),
          self._ipfs.object.get(files[0].hash, { enc: 'base58' })
        ])
      })
      .then((results) => {
        const emptyHeadDAG = results[0]
        const dataDAG = results[1]

        const link = dataDAG.toJSON()
        link.name = 'data'

        return self._ipfs.object.patch.addLink(emptyHeadDAG.multihash, link)
      })
      .then(self._ipfs.object.put)
  }

  /**
   * Broadcast new data to subscribers; store the new head locally
   * Note: this will eventually act as an 'atomic action'
   *
   * @param {Buffer|Object} data
   * @param {String} id
   * @returns {Promise} resolves with the newly published head's hash
   */
  const broadcastAndStore = (id, dag) => {
    log.info(`${MODULE_NAME}: Broadcasting and storing ${dag.toJSON().multihash}`)

    const mh = dag.toJSON().multihash
    const mhBuf = new Buffer(mh)

    return self._ipfs.pubsub.publish(id, mhBuf)
      .then(() => {
        console.log(id, 'PUBLISHING: ', mh)
        return self.heads.setHeadForStream(id, mh)
      })
      // Note: catch might handle the idea of 'rollbacks' in an early 'atomic' version
  }

  /**
   * Publish a new root for a specified id
   * Warning: This entirely resets the published history
   *
   * @param {String} id
   * @param {Buffer} buf
   * @returns {Promise} resolves with the newly published head's hash
   */
  const publishRoot = (id, buf) => {
    log.info(`${MODULE_NAME}: Publishing new root`)
    return createHead(buf)
      .then((dag) => broadcastAndStore(id, dag))
  }

  /**
   * Publish new data for a specified id
   * Warning: This entirely resets the published history
   *
   * @param {String} id
   * @param {Buffer} buf
   * @returns {Promise} resolves with the newly published head's hash
   */
  const publishData = (id, buf) => {
    log.info(`${MODULE_NAME}: Publishing new data`)

    const prevHash = self.heads.getHeadForStream(id)

    return Promise.all([
        createHead(buf),
        self._ipfs.object.get(prevHash, { enc: 'base58' }) // avoid this lookup by storing whole DAG
      ])
      .then((results) => {
        const newHeadDAG = results[0]
        const link = results[1].toJSON()
        link.name = 'prev'

        console.log('prev', link)
        console.log('prev hash', prevHash)
        console.log('')

        return self._ipfs.object.patch.addLink(newHeadDAG.multihash, link)
      })
      .then(self._ipfs.object.put)
      .then((dag) => broadcastAndStore(id, dag))
  }

  /**
   * API
   *
   * Publish data for a specified id
   *
   * @param {String} id
   * @param {Buffer|Object} data
   * @returns {Promise} resolves with the newly published head's hash
   */
  return (id, data) => {
    let dataBuf = data
    if (!Buffer.isBuffer(dataBuf)) {
      dataBuf = new Buffer(dataBuf)
    }

    // TODO: ensure getHeadForStream is efficient in its lookups
    // or store something locally once publish happens and refer here first
    if (self.heads.getHeadForStream(id)) {
      return publishData(id, dataBuf)
    }
    return publishRoot(id, dataBuf)
  }
}

