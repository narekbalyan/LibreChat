const { EModelEndpoint } = require('librechat-data-provider');
const { encodeAndFormat } = require('~/server/services/Files/images/encode');
const BaseClient = require('~/app/clients/BaseClient');
const { logger } = require('~/config');
const axios = require('axios');
const { createContextHandlers, truncateText } = require('~/app/clients/prompts');
const mlGatewayErrorHandle = require('~/app/clients/utils/mlGatewayErrorHandle');
const { STACK_ID } = process.env;
const fs = require('fs');

class MLGatewayCustomOpenAIClient extends BaseClient {
  constructor(options = {}) {
    super(null, options);
    this.options = {};
    this.modelOptions = {};
    this.setOptions(options);
    this.sender = this.options.modelOptions.model;
    this.completionsUrl = this.options.endpointHost;
  }

  setOptions(options) {
    if (options) {
      this.options = options;
    }
    return this;
  }

  getSaveOptions() {
    return {
      endpoint: this.options?.endpoint,
      model: this.options?.model,
      attachments: this.options.attachments,
      artifacts: this.options.artifacts,
      maxContextTokens: this.options.maxContextTokens,
      chatGptLabel: this.options.chatGptLabel,
      promptPrefix: this.options.promptPrefix,
      resendFiles: this.options.resendFiles,
      imageDetail: this.options.imageDetail,
      modelLabel: this.options.modelLabel,
      iconURL: this.options.iconURL,
      greeting: this.options.greeting,
      spec: this.options.spec,
      ...this.modelOptions,
    };
  }

  getBuildMessagesOptions(opts) {
    return opts;
  }

  async addImageURLs(message, attachments) {
    const { files, image_urls } = await encodeAndFormat(
      this.options.req,
      attachments,
      EModelEndpoint.custom,
    );
    message.image_urls = image_urls.length ? image_urls : undefined;
    return files;
  }

  async buildMessages(messages, parentMessageId) {
    const orderedMessages = this.constructor.getMessagesForConversation({
      messages,
      parentMessageId,
    });

    if (this.options.attachments) {
      const attachments = await this.options.attachments;
      // const images = attachments.filter((file) => file.type.includes('image'));

      const latestMessage = orderedMessages[orderedMessages.length - 1];

      if (this.message_file_map) {
        this.message_file_map[latestMessage.messageId] = attachments;
      } else {
        this.message_file_map = {
          [latestMessage.messageId]: attachments,
        };
      }

      if (attachments.length && attachments[0].type?.endsWith('csv')) {
        latestMessage.csv_url = attachments[0].filepath;
      } else {
        this.options.attachments = await this.addImageURLs(latestMessage, attachments);
      }
    }

    if (this.message_file_map) {
      this.contextHandlers = createContextHandlers(
        this.options.req,
        orderedMessages[orderedMessages.length - 1].text,
      );
    }
    return {
      prompt: orderedMessages,
    };
  }

  async sendMLGatewayRequest(messageContent, requestId) {
    try {
      const meta/*: EnvelopeMeta*/ = {
        RequestorId: STACK_ID,
        ProjectId: this.options.modelOptions.model,
        ApplicationId: this.options.endpoint.toLowerCase(),
        ApplicationVersion: '1.0.0',
        EnvelopeSchemaVersion: '3.0.0',
        PayloadSchemaVersion: '1.1.0',
      };

      const messagePayload = {
        openai_api_request: {
          model: this.options.modelOptions.model,
          max_tokens: 1000,
          messages: messageContent,
        },
        output: {},
      };

      const envelopeMessage/*: EnvelopeMessage */ = {
        RequestId: requestId,
        Payload: messagePayload,
      };

      const mlGwRequest/*: Envelope */ = {
        Meta: meta,
        Messages: [envelopeMessage],
      };
      const completionsUrl = `${this.options.reverseProxyUrl}/${this.options.modelOptions.model}`;
      // const headers = await TrackingHeaders(this.options.req.headers, requestId, 'ml-gateway-custom-openai-chat');
      const response = await axios.post(completionsUrl, mlGwRequest);
      return response.data?.Messages[0]?.Payload?.completion?.choices[0]?.message?.content;
    } catch (error) {
      mlGatewayErrorHandle(error);
    }
  }

  async sendCompletion(payload, opts = {}) {
    try {
      const messageContent = payload.map((chatMessage) => {
        const message = {
          role: chatMessage.isCreatedByUser ? 'user' : 'assistant',
          content: chatMessage.text,
        };
        if (chatMessage.image_urls?.length > 0) {
          const imageData = chatMessage.image_urls[0].image_url.url;
          const parts = imageData.split(', ');
          const fileType = parts[0].split(':')[1].split(';')[0];
          const mediaBase64MessageData = parts[0];
          const base64Index = mediaBase64MessageData.indexOf('base64');
          const imageBase64String = mediaBase64MessageData.substring(base64Index + 7);
          message.content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: fileType,
              data: imageBase64String,
            },
          });
        }

        if (chatMessage.csv_url) {
          const csvData = fs.readFileSync(`.${chatMessage.csv_url}`, 'utf8');
          message.content = `${message.content}:\n\n${csvData}`;
        }
        return message;
      });
      const requestId = payload[payload.length - 1].messageId;
      return await this.sendMLGatewayRequest(messageContent, requestId);
    } catch (error) {
      return mlGatewayErrorHandle(error);
    }
  }

  async cleanupString(inputString) {
    // Check if the string is valid
    if (!inputString || typeof inputString !== 'string') {
      return '';
    }

    // Step 1: Find "</think>" and remove everything before it and itself
    const thinkEndTag = '</think>';
    const thinkEndIndex = inputString.indexOf(thinkEndTag);
    let result = 'New Chat !';
    if (thinkEndIndex !== -1) {
      // Remove everything up to and including "</think>"
      result = inputString.substring(thinkEndIndex + thinkEndTag.length);
    }

    // Step 2: Remove all special symbols (keeping only letters, numbers, and spaces)
    result = result.replace(/[^\w\s]/g, '');

    // Step 3: Trim the string (remove leading and trailing whitespace)
    result = result.trim();

    return result;
  }

  async titleConvo(c) {
    const convo = `||>User:
"${truncateText(c.text)}"
||>Response:
"${JSON.stringify(truncateText(c.responseText))}"`;
    const request = `Please generate a title for this conversation. You can't use Title world in your answer

${convo}`;
    const response =  await this.sendMLGatewayRequest([{
      'role': 'user',
      'content': request,
    }], c.conversationId);

    return await this.cleanupString(response);
  }

  checkVisionRequest(attachments) {
    logger.info(
      '[api/app/clients/MLGatewayCustomOpenAIClient.js #checkVisionRequest] not implemented',
      attachments,
    );
  }
}

module.exports = MLGatewayCustomOpenAIClient;
