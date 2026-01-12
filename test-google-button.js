import { chromium } from 'playwright';

async function testGoogleButton() {
    console.log('🔍 Verificando botón de Google en Staging...\n');
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        console.log('1. Navegando a staging...');
        await page.goto('https://classroompath-staging.duckdns.org/', { 
            waitUntil: 'networkidle' 
        });
        
        console.log('2. Esperando 3 segundos para carga completa...');
        await page.waitForTimeout(3000);
        
        console.log('3. Verificando pantalla de login...');
        const loginScreen = await page.locator('#login-screen');
        const isLoginVisible = await loginScreen.isVisible();
        console.log(`   ✓ Pantalla de login visible: ${isLoginVisible}`);
        
        console.log('4. Verificando contenedor del botón de Google...');
        const googleBtnContainer = await page.locator('#google-signin-btn');
        const containerExists = await googleBtnContainer.count() > 0;
        console.log(`   ✓ Contenedor existe: ${containerExists}`);
        
        console.log('5. Verificando si el botón fue renderizado...');
        const googleButton = await page.locator('#google-signin-btn iframe, #google-signin-btn div[role="button"]');
        const buttonCount = await googleButton.count();
        console.log(`   ${buttonCount > 0 ? '✅' : '❌'} Botón de Google encontrado: ${buttonCount} elementos`);
        
        if (buttonCount === 0) {
            console.log('\n❌ PROBLEMA: El botón de Google NO se renderizó');
            console.log('   Contenido del contenedor:');
            const containerHTML = await page.locator('#google-signin-btn').innerHTML();
            console.log(`   "${containerHTML}"`);
            
            console.log('\n   Verificando errores en consola:');
            page.on('console', msg => console.log('   CONSOLE:', msg.text()));
            page.on('pageerror', err => console.log('   ERROR:', err.message));
        } else {
            console.log('\n✅ SUCCESS: Botón de Google renderizado correctamente');
        }
        
        console.log('\n6. Tomando screenshot...');
        await page.screenshot({ path: 'test-results/google-button-login.png', fullPage: true });
        console.log('   ✓ Screenshot guardado: test-results/google-button-login.png');
        
        console.log('\n7. Navegando a pantalla de registro...');
        await page.click('#goto-register-link');
        await page.waitForTimeout(2000);
        
        console.log('8. Verificando botón en registro...');
        const registerButton = await page.locator('#google-signup-btn iframe, #google-signup-btn div[role="button"]');
        const registerButtonCount = await registerButton.count();
        console.log(`   ${registerButtonCount > 0 ? '✅' : '❌'} Botón en registro: ${registerButtonCount} elementos`);
        
        if (registerButtonCount === 0) {
            console.log('\n❌ PROBLEMA: Botón de registro no renderizado');
            const regContainerHTML = await page.locator('#google-signup-btn').innerHTML();
            console.log(`   Contenido: "${regContainerHTML}"`);
        }
        
        await page.screenshot({ path: 'test-results/google-button-register.png', fullPage: true });
        console.log('   ✓ Screenshot: test-results/google-button-register.png');
        
        console.log('\n' + '='.repeat(60));
        if (buttonCount > 0 && registerButtonCount > 0) {
            console.log('✅ RESULTADO FINAL: Ambos botones funcionan correctamente');
        } else {
            console.log('❌ RESULTADO FINAL: Hay problemas con los botones');
        }
        console.log('='.repeat(60));
        
        console.log('\nPresiona Ctrl+C para cerrar o espera 10 segundos...');
        await page.waitForTimeout(10000);
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
    } finally {
        await browser.close();
    }
}

testGoogleButton().catch(console.error);
