export default {
    protocol: process.env.WUD_PROTOCOL || 'http',
    host: process.env.WUD_HOST || 'localhost',
    port: process.env.WUD_PORT || 3000,
    username: process.env.WUD_USERNAME || 'john',
    password: process.env.WUD_PASSWORD || 'doe',
    ecrRegistryUrl: process.env.ECR_REGISTRY_URL ? `https://${process.env.ECR_REGISTRY_URL}/v2` : 'https://229211676173.dkr.ecr.eu-west-1.amazonaws.com/v2',
    ecrImageName: process.env.ECR_IMAGE_NAME || 'sub/sub/test',
    acrClientId: process.env.ACR_CLIENT_ID || '89dcf54b-ef99-4dc1-bebb-8e0eacafdac8',
    awsRegion: process.env.AWS_REGION || 'eu-west-1',
};
