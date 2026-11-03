package com.napoleon.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

// Registers NapoleonProperties here (not via a scan) so @WebMvcTest slices, which load
// WebMvcConfigurers, get it too.
@Configuration
@EnableConfigurationProperties(NapoleonProperties.class)
public class WebConfig implements WebMvcConfigurer {

    private final NapoleonProperties props;

    public WebConfig(NapoleonProperties props) {
        this.props = props;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        if (props.corsAllowedOrigins() == null || props.corsAllowedOrigins().isEmpty()) {
            return;
        }
        registry.addMapping("/api/**")
                .allowedOrigins(props.corsAllowedOrigins().toArray(String[]::new))
                .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
                .exposedHeaders("Content-Range", "Accept-Ranges", "Content-Length");
    }
}
