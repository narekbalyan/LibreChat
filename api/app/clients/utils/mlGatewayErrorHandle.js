const mlGatewayErrorHandle = (error) => {
  if (typeof error === 'string') {
    throw error;
  }
  if (!error.response?.status) {
    throw error;
  }
  switch (error.response.status) {
    case 400: {
      const mlGatewayError = error.response.data.Messages[0];
      const webServiceResponseBody = JSON.parse(mlGatewayError.Status[0].Error.Variables[2].Value);
      switch (webServiceResponseBody?.ErrorCode) {
        case 'NO_CAPACITY_FOR_INFERENCE_COMPONENT': {
          throw new Error(
            JSON.stringify({
              type: 'ErrorTypes.NO_CAPACITY_FOR_INFERENCE_COMPONENT',
            }),
          );
        }
      }
    } break;
    case 404: {
      console.error('[ALERT] Error 404. Invalid request : ', error.response.request.path);
      throw new Error(
        JSON.stringify({
          type: 'ErrorTypes.THIS_MODEL_ENDPOINT_DOES_NOT_AVAILABLE',
        }),
      );
    }
    default: {
      console.error('[ALERT] Error:', error);
      let detail;
      try {
        detail = JSON.parse(error.response.headers['error']).detail;
      } catch (e) {
        throw new Error(
          JSON.stringify({
            type: 'ErrorTypes.SOMETHING_WENT_WRONG',
          }),
        );
      }
      throw new Error(detail);
    }
  }
};

module.exports = mlGatewayErrorHandle;
