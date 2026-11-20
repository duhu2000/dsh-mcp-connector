// Synthetic schema based on the displayed DZH getCompanyProfile structure.
// No credentials, production endpoint, customer data or business calls.
export const nestedArgumentsSchema = {
  type: 'object', required: ['param'], properties: {
    param: { type: 'object', required: ['stockCode'], properties: {
      stockCode: { type: 'string' },
      getF10GsjsData: { type: 'boolean' },
      getF10Information: { type: 'boolean' },
      getF10BusiinfoData: { type: 'object', properties: { typeStyle: { type: 'integer' } } },
    } },
  },
};
