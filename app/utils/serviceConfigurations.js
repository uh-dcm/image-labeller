

import getId from '../utils/getId'
import getSignatureKey from '../utils/getSignatureKey'
import crypto from 'crypto-js'
import moment from 'moment'
import sha256 from 'crypto-js/sha256'

//import jwt from 'jsonwebtoken'

class ServiceConfiguration {



    constructor(configuration, path) {
        this.name = configuration.name

        // Store all options as properties of "this"
        // Options are referenced like this: THIS.API_KEY
        configuration.options.forEach(opt => {
            this[opt.name] = opt.value
        })


        this.imgPath = path
    }

    getName = () => {
        return this.name
    }

    getTimestamp = () => {
        return new Date().toISOString().split('T').join(' ') // Formatted to eg. "2020-08-10 14:30:45.399Z"
    }

}

class AzureConfig extends ServiceConfiguration {

    constructor(configuration, path) {
        super(configuration, path)
    }

    getHeaders = () => {
        return {
            'Ocp-Apim-Subscription-Key': this.API_KEY,
            'Content-Type': this.imgPath.type === 'url' ? 'application/json' : 'application/octet-stream'
        }
    }

    getURL = () => {
        return this.API_ENDPOINT.concat(this.API_URL_QUERY);
    }

    getParams = () => {
        return {
        }
    }

    getBody = () => {
        if (this.imgPath.type === 'url') {
            return { "url": this.imgPath.path }
        }
        if (this.imgPath.type === 'localPath') {
            const file = window.api.getFile(this.imgPath.path)
            console.log('file', file)
            return file
        }

    }

    getHandleResponse = () => {

        const manipulateTag = (tag) => (
            {
                path: this.imgPath.path,
                type: this.imgPath.type,
                service: this.name,
                label: tag.name.toLowerCase(),
                accuracy: tag.confidence,
                id: getId(),
                time: this.getTimestamp(),
                parents: []
            }
        )

        return (response) => {
            return response.data.tags.map(manipulateTag)
        }
    }

}


class AWSconfig extends ServiceConfiguration {

    constructor(configuration, path) {
        super(configuration, path)
    }

    getHeaders = async () => {

        const body = await this.getBody()

        const requestPayload = JSON.stringify(body)

        const date = moment.utc().format("YYYYMMDD")
        const amzdate = moment.utc().format("YYYYMMDDTHHmmss") + 'Z'

        const contenttype = 'application/x-amz-json-1.1'

        const region = 'eu-central-1'
        const host = 'rekognition.' + region + '.amazonaws.com'
        const credentialScope = date + '/' + region + '/rekognition/aws4_request'

        const signedHeaders = 'content-type;host;x-amz-date'
        const algorithm = 'AWS4-HMAC-SHA256'

        const canonicalRequest =
            'POST\n' +
            '/\n' +
            '\n' +
            'content-type:' + contenttype + '\n' +
            'host:' + host + '\n' +
            'x-amz-date:' + amzdate + '\n\n' +
            signedHeaders + '\n' +
            sha256(requestPayload).toString()

        const string_to_sign =
            algorithm + '\n' +
            amzdate + '\n' +
            credentialScope + '\n' +
            sha256(canonicalRequest).toString()

        const signingKey = getSignatureKey(
            this.SECRET_ACCESS_KEY,
            date,
            region,
            "rekognition"
        )

        const signature = crypto.HmacSHA256(string_to_sign, signingKey).toString()

        const auth = `${algorithm} Credential=` + this.ACCESS_KEY_ID + `/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

        return {
            'Authorization': auth,
            'Content-Type': contenttype,
            'host': host,
            'x-amz-date': amzdate,
            'x-amz-target': 'RekognitionService.DetectLabels'
        }

    }


    getBody = async () => {
        let body = {
            Image: {
                Bytes: ''
            },
            MinConfidence: 0.0
        }

        if (this.imgPath.type === 'localPath') {

            const image = window.api.getFileAsBase64(this.imgPath.path)

            body.Image.Bytes = await image

            return body

        } else {
            const promise = window.api.getUrlAsBase64(this.imgPath.path)

            const image = await promise

            body.Image.Bytes = image

            return body

        }

    }


    getParams = () => {
        return {

        }
    }


    getURL = () => {
        return this.API_ENDPOINT

    }

    getHandleResponse = () => {

        const manipulateTag = (tag) => {
            return {
                path: this.imgPath.path,
                type: this.imgPath.type,
                service: this.name,
                label: tag.Name.toLowerCase(),
                accuracy: tag.Confidence / 100,
                id: getId(),
                time: this.getTimestamp(),
                parents: tag.Parents.map(parent => parent.Name.toLowerCase())
            }
        }


        return response => {
            return response.data.Labels.map(manipulateTag)
        }
    }
}


class GoogleConfig extends ServiceConfiguration {

    constructor(configuration, path) {
        super(configuration, path)
    }

    getHeaders = async () => {

        const iat = Math.floor(Date.now() / 1000)
        const exp = iat + 3600


        const payload = {
            iss: this.CLIENT_EMAIL,
            sub: this.CLIENT_EMAIL,
            aud: 'https://vision.googleapis.com/',
            iat: iat,
            exp: exp
        }

        const parsedPrivateKey = '-----BEGIN PRIVATE KEY-----\n' + this.PRIVATE_KEY.replace(/\s+/g, '\n') + '\n-----END PRIVATE KEY-----'

        let token
        // Prevent from trying to sign the token without real data
        if (this.PRIVATE_KEY !== '') {

            token = await window.api.signJsonWebToken({ payload, parsedPrivateKey })

        }



        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    }

    getBody = async () => {

        let base64Img
        if (this.imgPath.type === 'localPath') {
            base64Img = await window.api.getFileAsBase64(this.imgPath.path)
        } else {
            base64Img = await window.api.getUrlAsBase64(this.imgPath.path)
        }

        const body = {
            requests: [
                {
                    image: {
                        content: base64Img
                    },
                    features: [
                        {
                            type: "LABEL_DETECTION",
                            maxResults: 2147483647
                        }
                    ]
                }

            ]
        }

        return body
    }

    getParams = () => {
    }


    getURL = () => {
        return this.API_ENDPOINT.concat(this.API_URL_QUERY);
    }

    getHandleResponse = () => {

        const manipulateTag = (tag) => (
            {
                path: this.imgPath.path,
                type: this.imgPath.type,
                service: this.name,
                label: tag.description.toLowerCase(),
                accuracy: tag.score,
                id: getId(),
                time: this.getTimestamp(),
                parents: []
            }
        )

        return response => {
            return response.data.responses[0].labelAnnotations.map(manipulateTag)
        }
    }
}

export const createQuery = (config, path) => {

    let query


    if (config.name === 'Azure') {
        query = new AzureConfig(config, path)
    }

    if (config.name === 'IBM') {
        query = new IBMconfig(config, path)
    }

    if (config.name === 'AWS') {
        query = new AWSconfig(config, path)
    }


    if (config.name === 'Google') {
        query = new GoogleConfig(config, path)
    }


    return query
}



export default createQuery