package com.napoleon.config;

import java.util.concurrent.Executor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
@EnableAsync
public class AsyncConfig {

    public static final String MEDIA_EXECUTOR = "mediaProcessingExecutor";

    @Bean(name = MEDIA_EXECUTOR)
    public Executor mediaProcessingExecutor(NapoleonProperties props) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(props.processing().workerThreads());
        executor.setMaxPoolSize(props.processing().workerThreads());
        // Unbounded queue: uploads wait their turn rather than being rejected.
        executor.setQueueCapacity(Integer.MAX_VALUE);
        executor.setThreadNamePrefix("media-");
        executor.initialize();
        return executor;
    }
}
