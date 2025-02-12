require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api')
const path = require('path');
const axios = require('axios')
const TOKEN = "7149629717:AAE-zovzN-94_FRAanRb_aYrNZU9VgAugSE"
const express = require('express');

const { createClient } = require('@supabase/supabase-js');

const supabase = require('./supabaseClient');

console.log("Бот запущен...");
const languages = {
    en: require('./locales/en'),
    ru: require('./locales/ru'),
    uz: require('./locales/uz')
};
const branches = require('./data/branches')

const bot = new TelegramBot(TOKEN, {
    webHook: true
})
const app = express();
// Указываем Webhook URL
const WEBHOOK_URL = `https://tezkor-usta-bot.onrender.com/bot${TOKEN}`;
bot.setWebHook(WEBHOOK_URL);

app.use(express.json());

// Обработчик запросов от Telegram
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
const userSessions = {};

const twilio = require('twilio');
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = new twilio(accountSid, authToken);

async function sendVerificationCode(phoneNumber, code) {
    try {
        const message = await client.messages.create({
            body: `Your verification code: ${code}`,
            to: '+' + phoneNumber,
            from: process.env.TWILIO_PHONE_NUMBER, // Must be purchased number
            validityPeriod: 300  // 5 minutes expiration
        });
        return true;
    } catch (error) {
        console.error('Twilio Error Details:', {
            code: error.code,
            message: error.message,
            moreInfo: error.more_info
        });
        return false;
    }
}
const getMainMenuKeyboard = (langData) => {
    return {
        reply_markup: JSON.stringify({
            keyboard: [
                [langData.main_menu.services, langData.main_menu.branches],
                [langData.main_menu.feedback, langData.main_menu.settings],
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        })
    };
};

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    // Log the chatId for debugging
    console.log('User chatId:', chatId);

    // Check if the user is already registered and verified
    const { data: user, error } = await supabase
        .from('RegisteredUsers')
        .select('*')
        .eq('id', chatId)
        .maybeSingle(); // Use maybeSingle() to handle no rows found
    // Log the user data and error for debugging
    if (user && user.verified) {
        // User is already registered and verified, show main menu
        const langData = languages[user.lang];
        userSessions[chatId] = {
            step: 'main_menu',
            lang: user.lang,
            location: user.address,
            name: user.name,
            phone: user.phone
        };
        console.log(userSessions[chatId])
        bot.sendMessage(chatId, langData.greeting, getMainMenuKeyboard(langData));
        return;
    }
    // User is not registered or not verified, proceed to language selection
    const options = {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: 'English 🇺🇸', callback_data: 'lang_en' }],
                [{ text: 'Русский 🇷🇺', callback_data: 'lang_ru' }],
                [{ text: 'O\'zbekcha 🇺🇿', callback_data: 'lang_uz' }]
            ]
        })
    };

    bot.sendMessage(chatId, 'Choose language / Выберите язык / Tilni tanlang:', options);

    userSessions[chatId] = {
        step: 'choose_lang'
    };

    console.log('User session set to choose_lang:', userSessions[chatId]);
});

bot.on('callback_query', (query)=> {
    const chatId = query.message.chat.id
    if(!userSessions[chatId] || userSessions[chatId].step !== 'choose_lang') return
    const langCode = query.data.split('_')[1]
    if(['en', 'ru', 'uz'].includes(langCode)){
        userSessions[chatId] = {
            lang: langCode,
            step: 'request_phone'
        }
        const langData = languages[langCode];
        const phoneRequestOption = {
            reply_markup: JSON.stringify({
                keyboard: [[{text: langData.myNumber || 'Share contact', request_contact: true}]],
                resize_keyboard: true,
                one_time_keyboard: true
            })
        }
        bot.sendMessage(chatId, `${langData.selectedLang}\n${langData.sendNumber} \n+998 ** *** ****`, phoneRequestOption)
    }
})

// Phone number handler
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];

    if (!session || session.step !== 'request_phone') return;

    const langData = languages[session.lang];
    let phone = '';

    if (msg.contact) {
        phone = msg.contact.phone_number;
    } else if (msg.text.match(/^\d{12}$/)) {
        phone = '+' + msg.text.trim(); // добавляем + перед номером
    }else if (msg.text.match(/^\+?\d{12}$/)) {
        phone = msg.text.trim(); // если номер уже начинается с +, то просто сохраняем его
    }

    if (phone) {
        session.phone = phone;
        session.name = msg.chat.first_name
        // bot.sendMessage(chatId, `${langData.validNumber}\n${langData.choose_location}`, locationKeyboard);
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        session.verificationCode = verificationCode;

        // Send the verification code via SMS
        await sendVerificationCode(phone, verificationCode);

        // Prompt the user to enter the verification code
        bot.sendMessage(chatId, langData.enterVerificationCode);
        session.step = 'verify_code';
    } else {
        bot.sendMessage(chatId, langData.invalidNumberFormat || "Please provide a valid phone number");
    }
});
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];

    if (!session || session.step !== 'verify_code') return;

    const langData = languages[session.lang];
    const userCode = msg.text.trim();

    if (userCode === session.verificationCode) {
        // Code is correct, proceed to the next step
        session.verified = true;
        bot.sendMessage(chatId, langData.validNumber);

        // Save user data to Supabase
        try {

            // Proceed to the next step (e.g., choose location)
            session.step = 'choose_location';
            const locationKeyboard = {
                reply_markup: JSON.stringify({
                    inline_keyboard: branches.map(branch => [
                        { text: branch.name, callback_data: `location_${branch.code}` }
                    ])
                })
            };
            bot.sendMessage(chatId, langData.choose_location, locationKeyboard);
        } catch (err) {
            console.error('Unexpected error:', err);
            bot.sendMessage(chatId, langData.error_occurred || "An unexpected error occurred. Please try again.");
        }
    } else {
        bot.sendMessage(chatId, langData.invalidVerificationCode || "Invalid verification code. Please try again.");
    }
});
// Location selection handler and Main menu
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const session = userSessions[chatId];
    if (!session || session.step !== 'choose_location') return;

    const locationCode = query.data.split('_')[1];
    const selectedLocation = branches.find(branch => branch.code === locationCode);

    if (selectedLocation) {
        const langData = languages[session.lang];
        session.location = selectedLocation; // Store location in session
        const { data, error } = await supabase
            .from('RegisteredUsers')
            .insert([{
                id: chatId, // Ensure this column exists in Supabase
                phone: session.phone,
                name: session.name,
                lang: session.lang,
                verified: true,
                address: session.location,
            }]);

        if (error) {
            console.error('Error saving user data:', error);
            bot.sendMessage(chatId, langData.error_occurred || "An error occurred. Please try again.");
            return;
        }

        console.log('User data saved successfully:', data);
        session.step = 'main_menu'; // Next step: request phone number

        const mainMenuKeyboard = {
            reply_markup: JSON.stringify({
                keyboard: [
                    [langData.main_menu.services, langData.main_menu.branches],
                    [langData.main_menu.feedback, langData.main_menu.settings],
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            })
        };
        const videoPath = path.join(__dirname, 'public', 'images', 'Banner.mp4');
        await bot.sendVideo(chatId, videoPath)
        await bot.sendMessage(chatId, `${langData.location_selected.replace('{location}', selectedLocation.name)}\n${langData.greeting}`, mainMenuKeyboard);
    }
});

bot.on('message', (msg)=> {
    const chatId = msg.chat.id
    const session = userSessions[chatId]

    if(!session || session.step !== 'main_menu') return
    const langData = languages[session.lang]
    const text = msg.text
// Main Menu Keyboards
    switch(text){
        //Services keyboard
        case langData.main_menu.services:
            const serviceKeyboard = {
                reply_markup: JSON.stringify({
                    keyboard: [
                        [langData.services.plumber, langData.services.electrician],
                        [langData.services.welder, langData.goBack],
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                })
            }
            bot.sendMessage(chatId, langData.serviceTypeMessage, serviceKeyboard)
            session.step = 'services_menu'
            break
        //Feedback Keyboard
        case langData.main_menu.feedback:
            const feedback_message = `<b>${langData.call_center}</b> (33) 660-21-21`
            bot.sendMessage(chatId, feedback_message, {parse_mode: "HTML"})
            break
        //Branches Keyboard
        case langData.main_menu.branches:
            const branchesKeyboard = {
                reply_markup: JSON.stringify({
                    keyboard: [
                        [JSON.parse(session.location?.name)],
                        [langData.goBack]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                })
            }
            bot.sendMessage(chatId, langData.our_branches, branchesKeyboard)
            session.step = 'branches_cities_menu'
            break
        case langData.main_menu.settings:
            const settingKeyboard = {
                reply_markup: JSON.stringify({
                    keyboard: [
                        [langData.goBack, langData.settings.change_name],
                        [langData.settings.change_city, langData.settings.change_language],
                        [langData.settings.logout]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                })
            }
            bot.sendMessage(chatId, 'Выберите действие:', settingKeyboard)
            session.step = 'setting_menu'
    }

})
//Service select menu
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];

    if (!session || session.step !== 'services_menu' ) return;

    const langData = languages[session.lang];
    const service = msg.text;
    if (service === langData.goBack) {
        session.step = 'main_menu'
    } else if(service === langData.services.electrician || service === langData.services.plumber || service === langData.services.welder) {
        // Use location in service request
        const location = JSON.parse(session.location)
        bot.sendMessage(chatId, `${langData.selectedService || "Service selected:"} ${service} ${langData.in} ${location.name}`);
    }
});

// Handle "Back to Main Menu" button
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];

    if (!session) return;

    const langData = languages[session.lang];
    const text = msg.text;

    // Check if the user clicked "Back to Main Menu"
    if (text === langData.goBack) {
        session.step = 'main_menu'; // Update session step
        bot.sendMessage(chatId, langData.main_menu_prompt, getMainMenuKeyboard(langData));
    }
});

bot.on('message', async (msg)=> {
    const chatId = msg.chat.id
    const session = userSessions[chatId]
    const text =  msg.text

    if(!session || session.step !== 'branches_cities_menu') return

    const langData = languages[session.lang]

    if(text === session.location.name){
        const branch_info = `
        <b>ArzonUsta</b>
<code>${session.location.address.trim()}</code>
${session.location.work_time.trim()}
        `
        const latitude = '39.774232'
        const longitude = '64.412211'
        await bot.sendMessage(chatId, branch_info, {parse_mode:"HTML"})
        await bot.sendLocation(chatId, latitude, longitude)
    }
})

//Settings Menu
bot.on('message', (msg)=>{
    const chatId = msg.chat.id
    const session = userSessions[chatId]
    const text = msg.text

    if(!session || session.step !== 'setting_menu') return

    const langData = languages[session.lang]
//Settings Keyboards
    switch (text){
        //Change language Keyboard Click
        case langData.settings.change_language:
            session.step = 'setting_menu'
            break
        //Change name Keyboard Click
        case langData.settings.change_name:
            session.step = 'setting_menu'
            break
    }
})

//Change name Settings button Clicked
bot.on('message', async (msg)=>{
    const chatId = msg.chat.id
    const session = userSessions[chatId]
    const text = msg.text

    if(!session || session.step !== 'setting_menu') return
    const newName = msg.text
    const langData = languages[session.lang]
    if(text === langData.settings.change_name){
        const changeNameKeyboard={
            reply_markup: JSON.stringify({
                keyboard: [
                    [langData.go_back.settings_goBack]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            })
        }
        await bot.sendMessage(chatId, langData.enter_new_name.replace('{name}', ''), changeNameKeyboard)
        session.step = 'change_name'
    }else if(text === langData.settings.change_language){
        const chooseLangKeyboard = {
            reply_markup: JSON.stringify({
                inline_keyboard: [
                    [{ text: 'English 🇺🇸', callback_data: 'lang_en' },
                        { text: 'Русский 🇷🇺', callback_data: 'lang_ru' },
                        { text: 'O\'zbekcha 🇺🇿', callback_data: 'lang_uz' }],
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            })
        }
        await bot.sendMessage(chatId, langData.selectLang, chooseLangKeyboard)
        session.step = 'change_language';
    }
})
bot.on('callback_query', async (msg)=>{
    const chatId = msg.message.chat.id
    const session = userSessions[chatId]
    if(!session || session.step !== 'change_language') return
    const langCode = msg.data.split('_')[1]
    if(['en', 'ru', 'uz'].includes(langCode)){
        session.lang = langCode // Update language in session
        session.step = 'setting_menu' // Stay in settings menu
        const langData = languages[langCode]
        await bot.sendMessage(chatId, langData.language_updated.replace('{language}', langCode))

        const settingKeyboard = {
            reply_markup: JSON.stringify({
                keyboard: [
                    [langData.goBack, langData.settings.change_name],
                    [langData.settings.change_city, langData.settings.change_language],
                    [langData.settings.logout]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            })
        }

        await bot.sendMessage(chatId, langData.choose_action, settingKeyboard)
    }
})
// Handle new name input with async/await and error handling
bot.on('message', async (msg)=>{
    const chatId = msg.chat.id
    const session = userSessions[chatId]

    if(!session || session.step !== 'change_name') return
    const langData = languages[session.lang]
    const text = msg.text

    if(text=== langData.go_back.settings_goBack){
        session.step = 'setting_menu'
        const settingKeyboard = {
            reply_markup: JSON.stringify({
                keyboard: [
                    [langData.goBack, langData.settings.change_name],
                    [langData.settings.change_city, langData.settings.change_language],
                    [langData.settings.logout]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            })
        }
        await bot.sendMessage(chatId, langData.choose_action, settingKeyboard)
        return
    }
    if(text !== langData.settings.change_name && text !== langData.go_back.settings_goBack){
        try{
            //update name in session
            session.name = text


            // Send confirmation message
            await bot.sendMessage(chatId, langData.name_updated.replace('{name}', session.name))
            // Return to settings menu
            session.step = 'setting_menu';
            const settingKeyboard = {
                reply_markup: JSON.stringify({
                    keyboard: [
                        [langData.goBack, langData.settings.change_name],
                        [langData.settings.change_city, langData.settings.change_language],
                        [langData.settings.logout]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                })
            }
            await bot.sendMessage(chatId, langData.choose_action, settingKeyboard)
        }catch (error){
            console.error('Error updating name:', error);
            bot.sendMessage(chatId, langData.error_occurred || "An error occurred. Please try again.");
        }
    }
})

// Service selection handler
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];
    if (!session || session.step !== 'services_menu') return;

    const langData = languages[session.lang];
    const text = msg.text;

    if (Object.values(langData.services).includes(text)) {
        session.serviceRequest = {
            service: text,
            problemDescription: null,
            media: [],
            address: null
        };
        console.log(session.serviceRequest.service)

        const specifyProblemKeyboard = {
            reply_markup: JSON.stringify({
                keyboard: [[langData.skip_button]],
                resize_keyboard: true,
                one_time_keyboard: true
            })
        };
        await bot.sendMessage(chatId, langData.specify_problem, specifyProblemKeyboard);
        session.step = 'specify_problem';
    }
});

// Problem description handler - handles both text and photos
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];
    if (!session || session.step !== 'specify_problem') return;

    console.log('Handling problem description step');
    const langData = languages[session.lang];
    const request = session.serviceRequest;

    // Handle skip button
    if (msg.text === langData.skip_button) {
        console.log('Skipping description');
        request.problemDescription = "No description provided";
        await proceedToAddressStep(chatId, session, langData);
        return
    }

    // Handle text description
    if (msg.text) {
        console.log('Text description received:', msg.text);
        request.problemDescription = msg.text;
        await proceedToAddressStep(chatId, session, langData);
        return
    }

    // Handle photos
    if (msg.photo) {
        console.log('Photo received with caption:', msg.caption);
        request.media = msg.photo.map(p => p.file_id);
        request.problemDescription = msg.caption || "Attached photos";
        await proceedToAddressStep(chatId, session, langData);
        return
    }

    // If none of the above, remind user
    await bot.sendMessage(chatId, langData.specify_problem);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];
    if (!session || session.step !== 'collect_address') return;

    const langData = languages[session.lang];
    const text = msg.text;

    // Handle back to main menu
    if (text === langData.goBack) {
        session.step = 'main_menu';
        return bot.sendMessage(chatId, langData.main_menu_prompt, getMainMenuKeyboard(langData));
    }

    // Validate text address
    if (text && text.length >= 5) {
        session.serviceRequest.address = text;
        await proceedToTimeReservationStep(chatId, session, langData);
    } else {
        bot.sendMessage(chatId, langData.invalid_address);
    }
});

// Handle location messages separately
bot.on('location', async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];
    if (!session || session.step !== 'collect_address') return;

    const langData = languages[session.lang];
    const request = session.serviceRequest;

    // Store location coordinates
    request.address = {
        latitude: msg.location.latitude,
        longitude: msg.location.longitude
    };

    // await completeServiceRequest(chatId, session, langData);
    await proceedToTimeReservationStep(chatId, session, langData)
});

//Handle Time reservation
bot.on('message', async (msg)=>{
    const chatId = msg.chat.id;
    const session = userSessions[chatId];

    if (!session || session.step !== 'time_reservation') return;

    const request = session.serviceRequest;
    const langData = languages[session.lang];
    const text = msg.text;

    if(text === langData.chooseTime){
        console.log('I get EmergencyButton')
        request.time_reservation = 'Emergency'
        console.log(request)
        await completeServiceRequest(chatId, session, langData)
    }
    else{
        request.time_reservation =  text
        console.log('CHoose time' + " " + request)
        await completeServiceRequest(chatId, session, langData)
    }
})

bot.on('message', async (msg)=>{
    const chatId = msg.chat.id
    const session = userSessions[chatId]
    if(!session || session.step !== 'time_reservation') return
    const langData = languages[session.lang]

})

async function proceedToTimeReservationStep(chatId, session, langData){
    console.log('Proceeding to time reservation step')
    const reservationKeyboard = {
        reply_markup: JSON.stringify({
            keyboard: [
                [{text: langData.emergencyButton}]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
        })
    }
    await bot.sendMessage(chatId, langData.chooseTime, reservationKeyboard)
    session.step = 'time_reservation'
}
// Helper functions
async function proceedToAddressStep(chatId, session, langData) {
    console.log('Proceeding to address step');

    const addressKeyboard = {
        reply_markup: JSON.stringify({
            keyboard: [
                [{ text: langData.send_location,
                    request_location: true }],
                [langData.goBack]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        })
    };
    await bot.sendMessage(chatId, langData.enter_address, addressKeyboard);
    session.step = 'collect_address';
}

function getMainMenuKeyboardd(langData) {
    return {
        reply_markup: JSON.stringify({
            keyboard: [
                [langData.main_menu.services,langData.main_menu.branches],
                [langData.main_menu.feedback, langData.main_menu.settings],
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }),
        parse_mode: 'HTML'
    };
}

bot.on('polling_error', (error)=>{
    console.error("Polling error:", error);
})



async function processServiceRequest(session) {
    const requestData = {
        user: session.phone,
        name: session.name,
        location: session.location.name || session.location,
        service: session.serviceRequest.service,
        problem_description: session.serviceRequest.problemDescription,
        address: session.serviceRequest.address,
        time_reservation: session.serviceRequest.time_reservation,
        timestamp: new Date().toISOString()
    };

    console.log('Data to insert:', requestData);

    const { data, error } = await supabase
        .from('Users')
        .insert([requestData], { onConflict: ['id'] })
        .eq('user', session.user);

    if (error) {
        console.error('Error inserting data into Supabase:', {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint
        });
        throw error;
    }

    console.log('Data inserted successfully:', data);
}

async function completeServiceRequest(chatId, session, langData) {
    try {
        console.log('Completing service request:', session.serviceRequest);
        console.log('this is session:' + session)
        await processServiceRequest(session);
        delete session.serviceRequest;
        session.step = 'main_menu';
        const message = `
        <b>${langData.request_received}</b>
        <b>${langData.soon_call}</b>
        `;
        await bot.sendMessage(chatId, message, getMainMenuKeyboardd(langData));
    } catch (error) {
        console.error('Completion error:', error);
        bot.sendMessage(chatId, langData.error_occurred);
    }
}
