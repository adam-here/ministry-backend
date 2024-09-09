const express = require('express');
const bodyParser = require('body-parser');
const Dropbox = require('dropbox').Dropbox;
const Airtable = require('airtable');
require('dotenv').config();
const cors = require('cors');
const axios = require('axios')
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '100mb' })); // Example for a 100MB limit
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));


// Function to refresh access token
async function refreshAccessToken() {
    try {
        const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;  // Store refresh token securely
        const clientId = process.env.DROPBOX_APP_KEY;
        const clientSecret = process.env.DROPBOX_APP_SECRET;

        const response = await axios.post('https://api.dropboxapi.com/oauth2/token', new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
        }));

        // Save the new access token
        const newAccessToken = response.data.access_token;
        process.env.DROPBOX_APP_ACCESS_TOKEN = newAccessToken;

        return newAccessToken;
    } catch (error) {
        console.error('Error refreshing Dropbox access token:', error);
        throw error;
    }
}

// Dropbox OAuth Step
app.get('/auth/dropbox', (req, res) => {
    const redirectUri = process.env.REDIRECT_URI;
    const clientId = process.env.DROPBOX_APP_KEY;
    const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${clientId}&response_type=token&redirect_uri=${redirectUri}`;
    res.redirect(authUrl);
});

// Upload file to dropbox
app.post('/upload', async (req, res) => {
    const { fileContent, fileName, chunkIndex, totalChunks } = req.body;

    let accessToken = process.env.DROPBOX_APP_ACCESS_TOKEN;

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
    const uniqueFileName = `${timestamp}_${fileName}`;
    const encodedFileName = encodeURIComponent(uniqueFileName);

    const buffer = Buffer.from(fileContent, 'base64');

    try {

        const dbx = new Dropbox({ accessToken });
        try {
            const uploadResponse = await dbx.filesUpload({
                path: `/${encodedFileName}`,
                contents: buffer,
                mode: { '.tag': 'overwrite' },
            });

            // Optional: You can update progress on the backend if needed

            // Get the temporary link for download
            const tempLinkResponse = await dbx.filesGetTemporaryLink({
                path: uploadResponse.result.path_display,
            });

            const shareLinkResponse = await dbx.sharingCreateSharedLinkWithSettings({
                path: uploadResponse.result.path_display,
            });

            // Send back the upload status
            res.json({
                uploaded: true,
                downloadLink: tempLinkResponse.result.link,
                shareLink: shareLinkResponse.result.url,
            });
        } catch (error) {
            if (error.status === 401) {
                console.log('Access token expired, refreshing...');

                // Refresh the access token
                accessToken = await refreshAccessToken();

                // Retry upload with the new token
                const dbxWithNewToken = new Dropbox({ accessToken });
                const uploadResponse = await dbxWithNewToken.filesUpload({
                    path: `/${encodedFileName}`,
                    contents: buffer,
                    mode: { '.tag': 'overwrite' },
                });

                // Get the temporary link for download
                const tempLinkResponse = await dbxWithNewToken.filesGetTemporaryLink({
                    path: uploadResponse.result.path_display,
                });

                const shareLinkResponse = await dbxWithNewToken.sharingCreateSharedLinkWithSettings({
                    path: uploadResponse.result.path_display,
                });

                // Send back the upload status
                res.json({
                    uploaded: true,
                    downloadLink: tempLinkResponse.result.link,
                    shareLink: shareLinkResponse.result.url,
                });
            } else {
                throw error;
            }
        }


    } catch (error) {
        console.error('Error uploading to Dropbox:', error);
        res.status(500).send('Error uploading file to Dropbox');
    }
});


// Submit form to Airtable
app.post('/submit-form', async (req, res) => {
    const { name, email, description, downloadLink, shareLink } = req.body;
    const currentDate = new Date().toDateString();

    try {
        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
            process.env.AIRTABLE_BASE_ID
        );

        await base('Ministry').create({
            Name: name,
            Email: email,
            Description: description,
            DownloadLink: downloadLink,
            ShareLink: shareLink,
            SubmissionDate: currentDate
        });

        res.send('Form submitted successfully!');
    } catch (error) {
        console.error('Error sending form data to Airtable:', error);
        res.status(500).send('Error submitting form to Airtable');
    }
});


app.get('/', (req, res) => {
    res.send("Ministry Viniyard")
})

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
