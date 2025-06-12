const helperForSendingImageToGemini = (base64EncodedData, mimeType = "image/jpeg") => {
    return {
      inlineData: {
        mimeType,
        data: base64EncodedData,
      },
    };
  };
  
  module.exports = helperForSendingImageToGemini;